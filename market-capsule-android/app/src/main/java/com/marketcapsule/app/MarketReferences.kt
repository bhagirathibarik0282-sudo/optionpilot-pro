package com.marketcapsule.app

import org.json.JSONObject
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import kotlin.math.abs

internal data class ReferenceQuote(
    val price: Double,
    val previousClose: Double?,
    val dayOpen: Double?,
    val dayHigh: Double?,
    val dayLow: Double?,
    val observedAt: String,
    val receivedAt: String,
    val ageMs: Long,
    val expiry: String? = null,
    val contract: String? = null,
    val token: Long? = null
) {
    fun isFresh(state: MarketUiState): Boolean {
        val elapsed = state.receivedElapsedMs?.let {
            (state.currentElapsedMs - it).coerceAtLeast(0)
        } ?: return false
        return state.current?.connected == true && state.deliveryAgeMs >= 0 &&
            elapsed <= RESPONSE_MAX_AGE_MS &&
            ageMs + elapsed + state.deliveryAgeMs <= QUOTE_MAX_AGE_MS
    }
}

internal data class MarketContext(
    val indiaVix: ReferenceQuote? = null,
    val bankNiftySpot: ReferenceQuote? = null
)

internal data class PreviousSpotSession(val date: LocalDate, val high: Double, val low: Double)

internal data class MarketReference(
    val index: MarketIndex,
    val spot: ReferenceQuote?,
    val future: ReferenceQuote?,
    val verifiedBasis: Double?,
    val previousSpotSession: PreviousSpotSession? = null
) {
    fun eligible(state: MarketUiState, quote: ReferenceQuote?): Boolean {
        val current = state.current ?: return false
        return quote != null && (quote == spot || quote == future) &&
            state.selected == index && current.references[index] == this && quote.isFresh(state)
    }
    fun basis(state: MarketUiState): Double? =
        verifiedBasis?.takeIf { eligible(state, spot) && eligible(state, future) }
}

/** Optional references cannot replace or invalidate the existing spot/PCR panels. */
internal object MarketReferenceParser {
    private val india = ZoneId.of("Asia/Kolkata")
    private fun number(j: JSONObject, key: String): Double? =
        (j.opt(key) as? Number)?.toDouble()?.takeIf { it.isFinite() }
    private fun positive(j: JSONObject, key: String): Double? = number(j, key)?.takeIf { it > 0 }
    private fun text(j: JSONObject, key: String): String? =
        (j.opt(key) as? String)?.takeIf { it.isNotBlank() }

    private fun quote(j: JSONObject?, symbol: String?, role: String,
                      server: Instant, date: LocalDate): ReferenceQuote? {
        j ?: return null
        val id = j.optJSONObject("identity") ?: return null
        if (j.optString("state") != "LIVE" || id.opt("symbol") != symbol ||
            id.optString("role") != role) return null
        if (role == "VIX" && id.optString("label") != "INDIA VIX") return null
        val observed = text(j, "observedAt") ?: return null
        val received = text(j, "receivedAt") ?: return null
        val at = runCatching { Instant.parse(observed) }.getOrNull() ?: return null
        val receipt = runCatching { Instant.parse(received) }.getOrNull() ?: return null
        val age = Duration.between(at, server).toMillis()
        val receiptAge = Duration.between(receipt, server).toMillis()
        // Session OHLC is not accepted from pre-open/prior-session ticks.
        if (at.atZone(india).toLocalDate() != date || receipt.atZone(india).toLocalDate() != date ||
            at < date.atTime(9, 15).atZone(india).toInstant() ||
            age !in -5_000..QUOTE_MAX_AGE_MS || receiptAge !in 0..QUOTE_MAX_AGE_MS ||
            age + 5_000 < receiptAge) return null
        val price = positive(j, "price") ?: return null
        var expiry: String? = null
        var contract: String? = null
        var token: Long? = null
        if (role == "FUTURE") {
            expiry = text(id, "expiry") ?: return null
            if (!runCatching { LocalDate.parse(expiry).let {
                    it.toString() == expiry && it >= date
                } }.getOrDefault(false)) return null
            contract = text(id, "label") ?: return null
            token = number(id, "token")?.takeIf {
                it > 0 && it <= 9_007_199_254_740_991.0 && it % 1.0 == 0.0
            }?.toLong() ?: return null
        }
        var open = positive(j, "dayOpen")
        var high = positive(j, "dayHigh")
        var low = positive(j, "dayLow")
        if ((high != null && low != null && high < low) ||
            (open != null && high != null && open > high) ||
            (open != null && low != null && open < low)) {
            open = null; high = null; low = null
        }
        return ReferenceQuote(price, positive(j, "pdc"), open, high, low, observed, received,
            maxOf(0, age, receiptAge), expiry, contract, token)
    }

    fun parseParticipation(snapshot: JSONObject, server: Instant, connected: Boolean): ParticipationSnapshot? {
        val date = server.atZone(india).toLocalDate()
        if (!connected || snapshot.optString("tradeDate") != date.toString()) return null
        val source = snapshot.optJSONArray("participation") ?: return null
        if (source.length() > 256) return null

        val readings = mutableListOf<ParticipationReading>()
        val seenTokens = mutableSetOf<Long>()
        val duplicateTokens = mutableSetOf<Long>()
        val seenLabels = mutableSetOf<Pair<ParticipationKind, String>>()
        val duplicateLabels = mutableSetOf<Pair<ParticipationKind, String>>()
        for (position in 0 until source.length()) {
            val row = source.optJSONObject(position) ?: continue
            val identity = row.optJSONObject("identity") ?: continue
            val token = number(identity, "token")?.takeIf {
                it > 0 && it <= 9_007_199_254_740_991.0 && it % 1.0 == 0.0
            }?.toLong() ?: continue
            if (!seenTokens.add(token)) duplicateTokens.add(token)
            val kind = ParticipationKind.entries.find { it.name == identity.optString("role") } ?: continue
            val label = text(identity, "label") ?: continue
            if (!seenLabels.add(kind to label)) duplicateLabels.add(kind to label)
            val reading = runCatching { quote(row, null, kind.name, server, date) }.getOrNull() ?: continue
            val previousClose = reading.previousClose ?: continue
            val change = (reading.price / previousClose - 1) * 100
            if (!change.isFinite()) continue
            readings.add(ParticipationReading(kind, token, label, reading, change))
        }
        return ParticipationSnapshot(source.length(), readings.filter {
            it.token !in duplicateTokens && (it.kind to it.label) !in duplicateLabels
        })
    }

    fun parseContext(snapshot: JSONObject, server: Instant, connected: Boolean): MarketContext {
        val date = server.atZone(india).toLocalDate()
        if (!connected || snapshot.optString("tradeDate") != date.toString()) return MarketContext()

        val rows = snapshot.optJSONArray("indices")
        val bankNifty = if (rows == null) null else (0 until rows.length()).asSequence()
            .mapNotNull { rows.optJSONObject(it) }
            .filter { it.optString("symbol") == "BANKNIFTY" }
            .singleOrNull()
        val vix = runCatching {
            quote(snapshot.optJSONObject("vix"), null, "VIX", server, date)
        }.getOrNull()
        val bankSpot = runCatching {
            quote(bankNifty?.optJSONObject("spot"), "BANKNIFTY", "SPOT", server, date)
        }.getOrNull()
        return MarketContext(vix, bankSpot)
    }

    private fun previousSpotSession(
        row: JSONObject, index: MarketIndex, date: LocalDate, spot: ReferenceQuote?
    ): PreviousSpotSession? {
        val pdc = spot?.previousClose ?: return null
        val levels = row.optJSONObject("previousSpotSession") ?: return null
        val identity = row.optJSONObject("spot")?.optJSONObject("identity") ?: return null
        val token = positive(identity, "token") ?: return null
        if (token % 1.0 != 0.0 || token > 9_007_199_254_740_991.0 ||
            levels.opt("source") != "KITE_DAILY_CANDLE" || levels.opt("symbol") != index.name ||
            number(levels, "token") != token) return null
        val rawDate = text(levels, "sessionDate") ?: return null
        val sessionDate = runCatching { LocalDate.parse(rawDate) }.getOrNull() ?: return null
        if (sessionDate.toString() != rawDate || sessionDate >= date || sessionDate < date.minusDays(14)) return null
        val high = positive(levels, "high") ?: return null
        val low = positive(levels, "low") ?: return null
        val close = positive(levels, "close") ?: return null
        if (high < low || close !in low..high || abs(close - pdc) > 0.01) return null
        return PreviousSpotSession(sessionDate, high, low)
    }

    fun parse(snapshot: JSONObject, server: Instant, connected: Boolean): Map<MarketIndex, MarketReference> {
        if (!connected) return emptyMap()
        val date = server.atZone(india).toLocalDate()
        if (snapshot.optString("tradeDate") != date.toString()) return emptyMap()
        val rows = snapshot.optJSONArray("indices") ?: return emptyMap()
        val found = mutableMapOf<MarketIndex, MarketReference>()
        val seen = mutableSetOf<MarketIndex>()
        val duplicates = mutableSetOf<MarketIndex>()
        for (n in 0 until rows.length()) {
            val row = rows.optJSONObject(n) ?: continue
            val index = MarketIndex.entries.find { it.name == row.optString("symbol") } ?: continue
            if (!seen.add(index)) { duplicates.add(index); continue }
            val spot = runCatching { quote(row.optJSONObject("spot"), index.name, "SPOT", server, date) }.getOrNull()
            val future = runCatching { quote(row.optJSONObject("future"), index.name, "FUTURE", server, date) }.getOrNull()
            val basis = number(row, "futuresBasis")?.takeIf { value ->
                spot != null && future != null &&
                    abs(Duration.between(Instant.parse(spot.observedAt), Instant.parse(future.observedAt)).toMillis()) <= 5_000 &&
                    abs(value - (future.price - spot.price)) <= 1e-6
            }
            if (spot != null || future != null) found[index] = MarketReference(
                index, spot, future, basis, previousSpotSession(row, index, date, spot)
            )
        }
        duplicates.forEach { found.remove(it) }
        return found
    }
}

package com.marketcapsule.app

import org.json.JSONObject
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import kotlin.math.max
import kotlin.math.min

/** The premium endpoint is a read-only projection of already subscribed broker tokens. */
internal data class PreviousOptionLevels(val high: Double, val low: Double)
internal data class StrikeOption(
    val price: Double?, val ageMs: Long?, val observedAt: String?, val oi: Long? = null,
    val previousLevels: PreviousOptionLevels? = null, val token: Long? = null
)
internal data class StrikeRow(val strike: Double, val ce: StrikeOption?, val pe: StrikeOption?)
internal data class StrikeLadderRead(
    val index: MarketIndex, val expiry: String, val tradeDate: String, val runtimeId: String,
    val rows: List<StrikeRow>, val receivedElapsedMs: Long, val deliveryAgeMs: Long,
    val previousSessionDate: LocalDate? = null, val verifiedOi: VerifiedStrikeOi? = null
) {
    private fun isFresh(state: MarketUiState, leg: StrikeOption?): Boolean {
        val age = leg?.ageMs ?: return false
        val elapsed = (state.currentElapsedMs - receivedElapsedMs).coerceAtLeast(0)
        return state.selected == index && state.current?.runtimeId == runtimeId &&
            state.status == ReadingStatus.RECENT_SNAPSHOT && elapsed <= QUOTE_MAX_AGE_MS &&
            age + deliveryAgeMs + elapsed <= QUOTE_MAX_AGE_MS
    }

    fun isCurrent(state: MarketUiState, leg: StrikeOption?): Boolean =
        leg?.price != null && isFresh(state, leg)

    fun rankOi(state: MarketUiState, visible: List<StrikeRow>, band: Int,
               side: String? = null, select: (StrikeRow) -> StrikeOption?): StrikeOiRanks {
        // A canonical read-only REST snapshot is an independent, explicitly labelled
        // observation. Never mix it with WebSocket OI or borrow another contract.
        val verified = verifiedOi?.takeIf {
            state.selected == index && (side == "CE" || side == "PE") && visible.size == 2 * band + 1 &&
                it.eligible(state, runtimeId) && it.matches(visible)
        }
        val eligible = visible.mapNotNull { row ->
            val leg = select(row)
            val oi = if (verified != null) verified.rows[row.strike to side]?.second
                else leg?.oi?.takeIf { isFresh(state, leg) }
            if (oi != null) row.strike to oi else null
        }.toMap()
        val ordered = eligible.values.filter { it > 0 }.sortedDescending()
        val ranks = eligible.filterValues { it > 0 }.mapValues { ordered.indexOf(it.value) + 1 }
        val expected = 2 * band + 1
        val observed = visible.mapNotNull { row ->
            select(row)?.observedAt?.let { runCatching { Instant.parse(it).toEpochMilli() }.getOrNull() }
        }
        val complete = band in listOf(3, 5, 7) && eligible.size == expected &&
            visible.size == expected && (verified != null ||
                observed.size == expected &&
                observed.maxOrNull()!! - observed.minOrNull()!! <= QUOTE_MAX_AGE_MS)
        val walls = if (complete) ranks.filterValues { it == 1 }.keys.sorted() else emptyList()
        return StrikeOiRanks(eligible, ranks, walls, expected,
            if (verified?.scope == "BAND_AUDIT") "REST_BAND" else if (verified != null) "REST_SNAPSHOT" else "WEBSOCKET_FULL", verified?.checkedAt)
    }
}

internal data class StrikeOiRanks(
    val values: Map<Double, Long>,
    val ranks: Map<Double, Int>,
    val walls: List<Double>,
    val expected: Int, val source: String = "WEBSOCKET_FULL", val checkedAt: String? = null
)

/** A fixed strike identity cannot silently become another expiry, side or index. */
internal object StrikeLadderParser {
    private fun number(obj: JSONObject, key: String): Double? =
        (obj.opt(key) as? Number)?.toDouble()?.takeIf { it.isFinite() }
    private fun time(value: String?): Long? =
        runCatching { value?.let { Instant.parse(it).toEpochMilli() } }.getOrNull()

    fun parse(raw: String, index: MarketIndex, expiry: String, receivedWallMs: Long,
              receivedElapsedMs: Long, requestMs: Long = 0): StrikeLadderRead {
        require(requestMs in 0..QUOTE_MAX_AGE_MS) { "STRIKE_DELIVERY_TOO_OLD" }
        val envelope = JSONObject(raw)
        val response = if (envelope.has("snapshot")) {
            require(envelope.opt("connected") == true) { "STRIKE_LADDER_UNAVAILABLE" }
            envelope.optJSONObject("snapshot") ?: error("STRIKE_ROWS_MISSING")
        } else envelope
        val runtime = response.optString("runtimeId")
        require(runtime.isNotBlank()) { "STRIKE_RUNTIME_MISMATCH" }
        val date = response.optString("tradeDate")
        val india = ZoneId.of("Asia/Kolkata")
        val today = Instant.ofEpochMilli(receivedWallMs).atZone(india).toLocalDate()
        require(date == today.toString() && runCatching { LocalDate.parse(expiry) >= today }.getOrDefault(false)) {
            "STRIKE_SOURCE_DATE_MISMATCH"
        }
        val previousDateText = response.optString("previousOptionSessionDate")
        val previousDate = runCatching { LocalDate.parse(previousDateText) }.getOrNull()?.takeIf {
            it.toString() == previousDateText && it < today && it >= today.minusDays(14)
        }
        val incoming = response.optJSONArray("rows") ?: error("STRIKE_ROWS_MISSING")
        // Endpoint nearby=7 yields at most 15 strikes × two option sides.
        require(incoming.length() <= 32) { "STRIKE_RESPONSE_TOO_LARGE" }
        val strikes = sortedMapOf<Double, MutableMap<String, StrikeOption>>()
        val seen = mutableSetOf<Pair<Double, String>>()
        val oiTokens = mutableMapOf<Long, Pair<Double, String>>()
        for (i in 0 until incoming.length()) {
            val rawQuote = incoming.optJSONObject(i) ?: error("STRIKE_IDENTITY_MISMATCH")
            val identity = rawQuote.optJSONObject("identity") ?: error("STRIKE_IDENTITY_MISMATCH")
            val strike = number(identity, "strike")?.takeIf { it > 0 } ?: error("STRIKE_IDENTITY_MISMATCH")
            val side = identity.optString("side")
            require(identity.optString("role") == "OPTION" && identity.optString("symbol") == index.name &&
                identity.optString("expiry") == expiry && (side == "CE" || side == "PE")) {
                "STRIKE_IDENTITY_MISMATCH"
            }
            require(seen.add(strike to side)) { "STRIKE_DUPLICATE_CONTRACT" }
            val observed = rawQuote.optString("observedAt").takeIf { it.isNotBlank() && it != "null" }
            val received = rawQuote.optString("receivedAt").takeIf { it.isNotBlank() && it != "null" }
            val observedMs = time(observed)
            val receivedMs = time(received)
            val obsAge = observedMs?.let { receivedWallMs - it }
            val receiptAge = receivedMs?.let { receivedWallMs - it }
            val ageValid = obsAge != null && obsAge in -5_000..QUOTE_MAX_AGE_MS &&
                receiptAge != null && receiptAge in 0..QUOTE_MAX_AGE_MS && obsAge + 5_000 >= receiptAge
            val price = if (rawQuote.optString("state") == "LIVE" && ageValid)
                number(rawQuote, "price")?.takeIf { it > 0 } else null
            val age = if (ageValid) maxOf(0, obsAge!!, receiptAge!!) else null
            val sameSession = observedMs != null && receivedMs != null &&
                Instant.ofEpochMilli(observedMs).atZone(india).toLocalDate() == today &&
                Instant.ofEpochMilli(receivedMs).atZone(india).toLocalDate() == today
            val token = number(identity, "token")?.takeIf {
                it in 1.0..9_007_199_254_740_991.0 && it % 1.0 == 0.0
            }?.toLong()
            val previous = token?.let { oiTokens.putIfAbsent(it, strike to side) }
            if (previous != null) {
                val previousSides = strikes.getValue(previous.first)
                previousSides[previous.second] = previousSides.getValue(previous.second).copy(oi = null, previousLevels = null)
            }
            val oi = if (token != null && previous == null && rawQuote.optString("state") == "LIVE" && ageValid && sameSession) {
                number(rawQuote, "oi")?.takeIf {
                    it in 0.0..9_007_199_254_740_991.0 && it % 1.0 == 0.0
                }?.toLong()
            } else null
            val levels = rawQuote.optJSONObject("previousOptionSession")
                ?.takeIf { previousDate != null && token != null && previous == null &&
                    it.opt("source") == "RECORDER_CLOSE" && it.opt("sessionDate") == previousDateText &&
                    it.opt("symbol") == index.name && it.opt("expiry") == expiry && it.opt("side") == side &&
                    number(it, "token") == token.toDouble() && number(it, "strike") == strike }
                ?.let {
                    val high = number(it, "pdh")
                    val low = number(it, "pdl")
                    if (high != null && low != null && high >= low && low > 0) PreviousOptionLevels(high, low) else null
                }
            strikes.getOrPut(strike) { mutableMapOf() }[side] = StrikeOption(price, age, observed, oi, levels, token)
        }
        require(strikes.size <= 15) { "STRIKE_RESPONSE_TOO_LARGE" }
        return StrikeLadderRead(index, expiry, date, runtime,
            strikes.map { (strike, sides) -> StrikeRow(strike, sides["CE"], sides["PE"]) },
            receivedElapsedMs, requestMs, previousDate)
    }
}

/** Returns only exact available strikes relative to a server-verified ATM reference. */
internal fun visibleStrikeRows(rows: List<StrikeRow>, atm: Double?, band: Int): List<StrikeRow> {
    if (atm == null || band !in listOf(3, 5, 7)) return emptyList()
    val ordered = rows.sortedBy { it.strike }
    val position = ordered.indexOfFirst { it.strike == atm }
    if (position < 0) return emptyList()
    return ordered.subList(max(0, position - band), min(ordered.size, position + band + 1))
}

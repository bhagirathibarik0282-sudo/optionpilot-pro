package com.marketcapsule.app

import org.json.JSONObject
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import kotlin.math.max
import kotlin.math.min

/** The premium endpoint is a read-only projection of already subscribed broker tokens. */
internal data class StrikeOption(val price: Double?, val ageMs: Long?, val observedAt: String?)
internal data class StrikeRow(val strike: Double, val ce: StrikeOption?, val pe: StrikeOption?)
internal data class StrikeLadderRead(
    val index: MarketIndex, val expiry: String, val tradeDate: String, val runtimeId: String,
    val rows: List<StrikeRow>, val receivedElapsedMs: Long, val deliveryAgeMs: Long
) {
    fun isCurrent(state: MarketUiState, leg: StrikeOption?): Boolean {
        val elapsed = (state.currentElapsedMs - receivedElapsedMs).coerceAtLeast(0)
        return state.selected == index && state.current?.runtimeId == runtimeId &&
            state.status == ReadingStatus.RECENT_SNAPSHOT && elapsed <= QUOTE_MAX_AGE_MS &&
            leg?.price != null && leg.ageMs != null &&
            leg.ageMs + deliveryAgeMs + elapsed <= QUOTE_MAX_AGE_MS
    }
}

/** A fixed strike identity cannot silently become another expiry, side or index. */
internal object StrikeLadderParser {
    private fun number(obj: JSONObject, key: String): Double? =
        (obj.opt(key) as? Number)?.toDouble()?.takeIf { it.isFinite() }
    private fun time(value: String?): Long? =
        runCatching { value?.let { Instant.parse(it).toEpochMilli() } }.getOrNull()

    fun parse(raw: String, index: MarketIndex, expiry: String, receivedWallMs: Long,
              receivedElapsedMs: Long, requestMs: Long = 0): StrikeLadderRead {
        require(requestMs in 0..QUOTE_MAX_AGE_MS) { "STRIKE_DELIVERY_TOO_OLD" }
        val response = JSONObject(raw)
        val runtime = response.optString("runtimeId")
        require(runtime.isNotBlank()) { "STRIKE_RUNTIME_MISMATCH" }
        val date = response.optString("tradeDate")
        val today = Instant.ofEpochMilli(receivedWallMs).atZone(ZoneId.of("Asia/Kolkata")).toLocalDate()
        require(date == today.toString() && runCatching { LocalDate.parse(expiry) >= today }.getOrDefault(false)) {
            "STRIKE_SOURCE_DATE_MISMATCH"
        }
        val incoming = response.optJSONArray("rows") ?: error("STRIKE_ROWS_MISSING")
        // Endpoint nearby=7 yields at most 15 strikes × two option sides.
        require(incoming.length() <= 32) { "STRIKE_RESPONSE_TOO_LARGE" }
        val strikes = sortedMapOf<Double, MutableMap<String, StrikeOption>>()
        val seen = mutableSetOf<Pair<Double, String>>()
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
            val obsAge = time(observed)?.let { receivedWallMs - it }
            val receiptAge = time(received)?.let { receivedWallMs - it }
            val ageValid = obsAge != null && obsAge in -5_000..QUOTE_MAX_AGE_MS &&
                receiptAge != null && receiptAge in 0..QUOTE_MAX_AGE_MS && obsAge + 5_000 >= receiptAge
            val price = if (rawQuote.optString("state") == "LIVE" && ageValid)
                number(rawQuote, "price")?.takeIf { it > 0 } else null
            val age = if (ageValid) maxOf(0, obsAge!!, receiptAge!!) else null
            strikes.getOrPut(strike) { mutableMapOf() }[side] = StrikeOption(price, age, observed)
        }
        require(strikes.size <= 15) { "STRIKE_RESPONSE_TOO_LARGE" }
        return StrikeLadderRead(index, expiry, date, runtime,
            strikes.map { (strike, sides) -> StrikeRow(strike, sides["CE"], sides["PE"]) },
            receivedElapsedMs, requestMs)
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

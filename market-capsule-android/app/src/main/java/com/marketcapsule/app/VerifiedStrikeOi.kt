package com.marketcapsule.app

import org.json.JSONObject
import java.time.Instant
import java.time.ZoneId

/** A complete read-only REST expiry observation; never a live WebSocket tick. */
internal data class VerifiedStrikeOi(
    val checkedAt: String,
    val ageAtReceiptMs: Long,
    val receivedElapsedMs: Long,
    val rows: Map<Pair<Double, String>, Pair<Long, Long>>
) {
    fun eligible(state: MarketUiState, runtimeId: String): Boolean {
        val elapsed = state.currentElapsedMs - receivedElapsedMs
        return state.current?.connected == true && state.current?.runtimeId == runtimeId &&
            elapsed >= 0 && ageAtReceiptMs >= 0 &&
            ageAtReceiptMs + elapsed <= PCR_SNAPSHOT_MAX_AGE_MS
    }

    /** Both sides must have exact contract identities before using this source. */
    fun matches(visible: List<StrikeRow>): Boolean =
        visible.isNotEmpty() && visible.all { row ->
            listOf("CE" to row.ce, "PE" to row.pe).all { (side, leg) ->
                val verified = rows[row.strike to side]
                leg?.token != null && verified != null && verified.first == leg.token
            }
        }
}

/** Parses existing /dashboard-live PCR strikeRows. No fresh Kite request is made. */
internal object VerifiedStrikeOiParser {
    private val india = ZoneId.of("Asia/Kolkata")
    private fun n(o: JSONObject, key: String): Double? =
        (o.opt(key) as? Number)?.toDouble()?.takeIf { it.isFinite() }
    private fun integer(o: JSONObject, key: String): Long? =
        n(o, key)?.takeIf { it >= 0 && it <= 9_007_199_254_740_991.0 && it % 1.0 == 0.0 }?.toLong()
    private fun ms(value: String?): Long? =
        runCatching { Instant.parse(value).toEpochMilli() }.getOrNull()
    private fun date(t: Long): String = Instant.ofEpochMilli(t).atZone(india).toLocalDate().toString()

    fun parse(raw: String, index: MarketIndex, expiry: String, runtimeId: String,
              receivedWallMs: Long, receivedElapsedMs: Long): VerifiedStrikeOi? = runCatching {
        val root = JSONObject(raw)
        require(root.opt("connected") == true && root.optString("source") == "KITE_WEBSOCKET_FULL")
        val server = ms(root.optString("serverTime")) ?: error("MISSING_SERVER_TIME")
        require(receivedWallMs - server in -5_000..QUOTE_MAX_AGE_MS)
        val snap = root.getJSONObject("snapshot")
        require(snap.optString("runtimeId") == runtimeId && snap.optString("tradeDate") == date(server))
        val indices = snap.getJSONArray("indices")
        val matched = (0 until indices.length()).mapNotNull { indices.optJSONObject(it) }
            .filter { it.optString("symbol") == index.name }
        require(matched.size == 1 && date(server) == date(receivedWallMs) && expiry >= date(server))
        val selected = matched.single()
        require(selected.optString("expiry") == expiry)
        val q = selected.getJSONObject("pcrSnapshot")
        require(q.optString("source") == "KITE_REST_FULL_EXPIRY_SNAPSHOT" &&
            q.optString("state") == "COMPLETE" && q.optString("fetchState") == "OK")
        val checkedText = q.getString("checkedAt")
        val checked = ms(checkedText) ?: error("MISSING_CHECKED_AT")
        val age = receivedWallMs - checked
        require(checked <= server + 5_000 && server - checked in 0..PCR_SNAPSHOT_MAX_AGE_MS &&
            age in 0..PCR_SNAPSHOT_MAX_AGE_MS && date(checked) == date(server))
        val coverage = q.getJSONObject("coverage")
        val expected = integer(coverage, "expected") ?: error("NO_EXPECTED")
        require(expected in 30..3000 && integer(coverage, "freshOi") == expected &&
            coverage.opt("complete") == true && integer(coverage, "missing") == 0L &&
            integer(coverage, "stale") == 0L && integer(coverage, "invalid") == 0L &&
            n(coverage, "sourceSkewMs")?.let { it in 0.0..30_000.0 } == true)
        val source = q.getJSONArray("strikeRows")
        require(source.length().toLong() == expected)
        val rows = mutableMapOf<Pair<Double, String>, Pair<Long, Long>>()
        val tokens = mutableSetOf<Long>()
        var earliest = Long.MAX_VALUE
        var latest = Long.MIN_VALUE
        var ce = 0
        var pe = 0
        for (i in 0 until source.length()) {
            val row = source.getJSONObject(i)
            val side = row.optString("side")
            val strike = n(row, "strike")?.takeIf { it > 0 } ?: error("BAD_STRIKE")
            val token = integer(row, "token")?.takeIf { it > 0 } ?: error("BAD_TOKEN")
            val oi = integer(row, "oi") ?: error("BAD_OI")
            val at = ms(row.optString("sourceAt")) ?: error("BAD_TIME")
            require(row.optString("symbol") == index.name && row.optString("expiry") == expiry &&
                (side == "CE" || side == "PE") && date(at) == date(server) &&
                checked - at in -5_000..30_000 && tokens.add(token))
            require(rows.put(strike to side, token to oi) == null)
            earliest = minOf(earliest, at)
            latest = maxOf(latest, at)
            if (side == "CE") ce++ else pe++
        }
        require(ce > 0 && pe > 0 && latest - earliest <= 30_000)
        VerifiedStrikeOi(checkedText, age, receivedElapsedMs, rows)
    }.getOrNull()
}

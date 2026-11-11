package com.marketcapsule.app

import org.json.JSONObject
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

/** A complete read-only REST expiry observation; never a live WebSocket tick. */
internal data class VerifiedStrikeOi(
    val checkedAt: String,
    val ageAtReceiptMs: Long,
    val receivedElapsedMs: Long,
    val rows: Map<Pair<Double, String>, Pair<Long, Long>>,
    val scope: String = "FULL_EXPIRY",
    val sourceTimes: Map<Pair<Double, String>, Long> = emptyMap()
) {
    fun eligible(state: MarketUiState, runtimeId: String): Boolean {
        val elapsed = state.currentElapsedMs - receivedElapsedMs
        return state.current?.connected == true && state.current?.runtimeId == runtimeId &&
            elapsed >= 0 && ageAtReceiptMs >= 0 &&
            ageAtReceiptMs + elapsed <= PCR_SNAPSHOT_MAX_AGE_MS
    }

    /** Both sides must have exact contract identities before using this source. */
    fun matches(visible: List<StrikeRow>): Boolean {
        if (visible.isEmpty()) return false
        val keys = visible.flatMap { row -> listOf(row.strike to "CE", row.strike to "PE") }
        val paired = visible.all { row ->
            listOf("CE" to row.ce, "PE" to row.pe).all { (side, leg) ->
                val verified = rows[row.strike to side]
                leg?.token != null && verified != null && verified.first == leg.token
            }
        }
        if (!paired) return false
        if (scope != "BAND_AUDIT") return true
        val times = keys.mapNotNull { sourceTimes[it] }
        return times.size == keys.size &&
            (times.maxOrNull()!! - times.minOrNull()!!) <= QUOTE_MAX_AGE_MS
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

    /** Independent ±7 OI band from the SAME existing full-chain REST attempt.
     * The audit can be partial outside the band; no extra Kite request or
     * full-expiry PCR eligibility is inferred from its band rows.
     * Matching the cycle to the dashboard snapshot prevents runtime mixing.
     */
    fun parseBandAudit(auditRaw: String, snapshotRaw: String, index: MarketIndex,
                       expiry: String, runtimeId: String, receivedWallMs: Long,
                       receivedElapsedMs: Long): VerifiedStrikeOi? = runCatching {
        val root = JSONObject(snapshotRaw)
        require(root.opt("connected") == true &&
            root.optString("source") == "KITE_WEBSOCKET_FULL")
        val server = ms(root.optString("serverTime")) ?: error("MISSING_SERVER_TIME")
        require(receivedWallMs - server in -5_000..QUOTE_MAX_AGE_MS)
        val snap = root.getJSONObject("snapshot")
        val today = date(server)
        require(snap.optString("runtimeId") == runtimeId &&
            snap.optString("tradeDate") == today && date(receivedWallMs) == today &&
            expiry >= today)
        val indices = snap.getJSONArray("indices")
        val candidates = (0 until indices.length()).mapNotNull { indices.optJSONObject(it) }
            .filter { it.optString("symbol") == index.name }
        require(candidates.size == 1 && candidates.single().optString("expiry") == expiry)
        val q = candidates.single().getJSONObject("pcrSnapshot")
        require(q.optString("source") == "KITE_REST_FULL_EXPIRY_SNAPSHOT" &&
            q.optString("fetchState") == "OK" && q.optString("state") != "STALE")
        val auditRoot = JSONObject(auditRaw)
        require(auditRoot.opt("readOnly") == true &&
            auditRoot.opt("extraBrokerRequests") == 0 &&
            auditRoot.opt("connected") == true)
        val auditServer = ms(auditRoot.optString("serverTime")) ?: error("NO_AUDIT_TIME")
        require(date(auditServer) == today && auditServer - server in -5_000..QUOTE_MAX_AGE_MS &&
            receivedWallMs - auditServer in -5_000..QUOTE_MAX_AGE_MS)
        val audit = auditRoot.getJSONObject("audit")
        val checkedText = q.getString("checkedAt")
        val checked = ms(checkedText) ?: error("NO_CHECK_TIME")
        val cycleText = q.getString("cycleStartedAt")
        val cycle = ms(cycleText) ?: error("NO_CYCLE")
        require(checkedText == audit.optString("checkedAt") &&
            cycleText == audit.optString("cycleStartedAt") &&
            audit.optString("source") == q.optString("source") &&
            audit.optString("symbol") == index.name &&
            audit.optString("expiry") == expiry &&
            audit.optString("fetchState") == "OK" &&
            checked - cycle in 0..60_000 &&
            checked <= server + 5_000 && date(checked) == today &&
            server - checked in 0..PCR_SNAPSHOT_MAX_AGE_MS &&
            receivedWallMs - checked in 0..PCR_SNAPSHOT_MAX_AGE_MS)
        val coverage = q.getJSONObject("coverage")
        val expected = integer(coverage, "expected") ?: error("NO_COVERAGE")
        require(expected in 30..3000 && integer(audit, "expected") == expected)
        val evidence = audit.getJSONArray("rows")
        require(evidence.length().toLong() == expected)
        val byContract = mutableMapOf<Pair<Double, String>, Pair<Long, Long>>()
        val tokens = mutableSetOf<Long>()
        val contracts = mutableSetOf<Pair<Double, String>>()
        val sourceTimes = mutableMapOf<Pair<Double, String>, Long>()
        var matched = 0
        for (i in 0 until evidence.length()) {
            val row = evidence.getJSONObject(i)
            val strike = n(row, "strike")?.takeIf { it > 0 } ?: error("BAD_STRIKE")
            val side = row.optString("side")
            val token = integer(row, "token")?.takeIf { it > 0 } ?: error("BAD_TOKEN")
            require(row.optString("symbol") == index.name &&
                row.optString("expiry") == expiry &&
                (side == "CE" || side == "PE") && tokens.add(token) &&
                contracts.add(strike to side))
            val responseToken = integer(row, "responseToken")
            val oi = integer(row, "oi")
            val sourceAt = ms(row.optString("sourceAt"))
            if (responseToken == token && oi != null && sourceAt != null &&
                date(sourceAt) == today &&
                sourceAt >= LocalDate.parse(today).atTime(9, 15).atZone(india).toInstant().toEpochMilli() &&
                checked - sourceAt in -5_000..30_000) {
                byContract[strike to side] = token to oi
                sourceTimes[strike to side] = sourceAt
                matched++
            }
        }
        require(matched >= 2)
        // The ladder will independently demand BOTH exact tokens at EVERY
        // visible strike, and only then mark this as one synchronized source.
        VerifiedStrikeOi(checkedText, receivedWallMs - checked,
            receivedElapsedMs, byContract, "BAND_AUDIT", sourceTimes)
    }.getOrNull()
}

package com.marketcapsule.app

import java.time.Instant
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

/** Exercises independently complete ±7 OI when full-expiry PCR is incomplete. */
class VerifiedBandStrikeOiTest {
    private val checked = "2026-11-11T04:30:00Z"
    private val started = "2026-11-11T04:29:50Z"
    private val wall = Instant.parse(checked).toEpochMilli()
    private val expiry = "2026-11-17"

    private fun row(strike: Int, side: String, token: Int, timestamp: String = checked) =
        JSONObject().put("symbol", "NIFTY").put("expiry", expiry).put("strike", strike)
            .put("side", side).put("token", token).put("responseToken", token)
            .put("oi", token * 100).put("sourceAt", timestamp)

    private fun observation(): Pair<JSONObject, JSONObject> {
        val rows = JSONArray()
        for (i in 0 until 15) {
            rows.put(row(25000 + i * 50, "CE", i + 1))
            rows.put(row(25000 + i * 50, "PE", i + 101))
        }
        // These two outer contracts are not part of the ±7 band. One is stale.
        rows.put(row(26500, "CE", 600, "2026-11-11T04:27:00Z"))
        rows.put(row(26500, "PE", 601))
        val pcr = JSONObject().put("source", "KITE_REST_FULL_EXPIRY_SNAPSHOT")
            .put("fetchState", "OK").put("state", "INCOMPLETE")
            .put("checkedAt", checked).put("cycleStartedAt", started)
            .put("coverage", JSONObject().put("expected", 32).put("freshOi", 31)
                .put("complete", false).put("stale", 1).put("missing", 0)
                .put("invalid", 0).put("sourceSkewMs", 0))
        val snap = JSONObject().put("runtimeId", "fixture")
            .put("tradeDate", "2026-11-11")
            .put("indices", JSONArray().put(JSONObject().put("symbol", "NIFTY")
                .put("expiry", expiry).put("pcrSnapshot", pcr)))
        val live = JSONObject().put("connected", true).put("source", "KITE_WEBSOCKET_FULL")
            .put("serverTime", checked).put("snapshot", snap)
        val audit = JSONObject().put("readOnly", true).put("extraBrokerRequests", 0)
            .put("connected", true).put("serverTime", checked)
            .put("audit", JSONObject().put("symbol", "NIFTY").put("expiry", expiry)
                .put("source", "KITE_REST_FULL_EXPIRY_SNAPSHOT").put("fetchState", "OK")
                .put("expected", 32).put("checkedAt", checked)
                .put("cycleStartedAt", started).put("rows", rows))
        return live to audit
    }

    private fun ladder(): StrikeLadderRead {
        val rows = JSONArray()
        for (i in 0 until 15) {
            val strike = 25000 + i * 50
            for ((side, token) in listOf("CE" to (i + 1), "PE" to (i + 101))) {
                val id = JSONObject().put("symbol", "NIFTY").put("role", "OPTION")
                    .put("expiry", expiry).put("side", side)
                    .put("strike", strike).put("token", token)
                rows.put(JSONObject().put("identity", id).put("state", "STALE")
                    .put("observedAt", "2026-11-11T04:27:00Z")
                    .put("receivedAt", "2026-11-11T04:27:00Z"))
            }
        }
        return StrikeLadderParser.parse(JSONObject().put("runtimeId", "fixture")
            .put("tradeDate", "2026-11-11").put("rows", rows).toString(),
            MarketIndex.NIFTY, expiry, wall, 0)
    }

    private fun state(elapsed: Long = 0): MarketUiState {
        val index = MarketIndex.NIFTY
        val quote = Quote(index, 25350.0, 0.0, checked, checked, 0, "LIVE",
            expiry, 25350.0, null, null, null, null)
        val snap = MarketSnapshot("fixture", 1, checked, true, "OPEN", mapOf(index to quote))
        return MarketUiState(current = snap, receivedElapsedMs = elapsed, currentElapsedMs = elapsed)
    }

    private fun parse(live: JSONObject, audit: JSONObject) =
        VerifiedStrikeOiParser.parseBandAudit(audit.toString(), live.toString(),
            MarketIndex.NIFTY, expiry, "fixture", wall, 0)

    @Test fun incompleteFullExpiryStillRecoversSynchronizedThirtyLegBand() {
        val (live, audit) = observation()
        assertNull(VerifiedStrikeOiParser.parse(live.toString(), MarketIndex.NIFTY,
            expiry, "fixture", wall, 0))
        val verified = parse(live, audit)
        assertNotNull(verified)
        val read = ladder().copy(verifiedOi = verified)
        val ce = read.rankOi(state(), read.rows, 7, "CE") { it.ce }
        val pe = read.rankOi(state(), read.rows, 7, "PE") { it.pe }
        assertEquals(15, ce.values.size)
        assertEquals(15, pe.values.size)
        assertEquals("REST_BAND", ce.source)
        assertEquals("REST_BAND", pe.source)
        assertEquals(100L, ce.values[25000.0])
        assertEquals(10100L, pe.values[25000.0])
        assertTrue(ce.walls.isNotEmpty())
        assertTrue(pe.walls.isNotEmpty())
    }

    @Test fun incompleteInnerContractNeverBecomesFakeZeroOrWall() {
        val (live, audit) = observation()
        audit.getJSONObject("audit").getJSONArray("rows").getJSONObject(1)
            .put("sourceAt", "2026-11-11T04:27:00Z")
        val verified = parse(live, audit)
        assertNotNull(verified)
        val read = ladder().copy(verifiedOi = verified)
        val ranks = read.rankOi(state(), read.rows, 7, "PE") { it.pe }
        assertEquals(0, ranks.values.size)
        assertTrue(ranks.walls.isEmpty())
    }

    @Test fun bandWithThirtyLegsButMoreThanThirtySecondsSkewWithholdsWall() {
        val (live, audit) = observation()
        val rows = audit.getJSONObject("audit").getJSONArray("rows")
        rows.getJSONObject(1).put("sourceAt", "2026-11-11T04:29:29Z")
        rows.getJSONObject(0).put("sourceAt", "2026-11-11T04:30:01Z")
        // All individual quotes satisfy a bounded check, but together span 32 seconds.
        val verified = parse(live, audit)
        assertNotNull(verified)
        val read = ladder().copy(verifiedOi = verified)
        val ranks = read.rankOi(state(), read.rows, 7, "CE") { it.ce }
        assertTrue(ranks.values.isEmpty())
        assertTrue(ranks.walls.isEmpty())
    }

    @Test fun wrongCycleTokenRuntimeOrConnectionFailsClosed() {
        val changes = listOf<(JSONObject, JSONObject) -> Unit>(
            { _, a -> a.getJSONObject("audit").put("cycleStartedAt", "2026-11-11T04:29:40Z") },
            { _, a -> a.getJSONObject("audit").getJSONArray("rows").getJSONObject(1)
                .put("responseToken", 9999) },
            { l, _ -> l.getJSONObject("snapshot").put("runtimeId", "another") },
            { l, _ -> l.put("connected", false) },
            { _, a -> a.getJSONObject("audit").put("connected", false) },
            { _, a -> a.put("extraBrokerRequests", 1) },
            { l, _ -> l.getJSONObject("snapshot").getJSONArray("indices").getJSONObject(0)
                .put("expiry", "2026-11-24") }
        )
        for ((i, change) in changes.withIndex()) {
            val (live, audit) = observation()
            change(live, audit)
            val found = parse(live, audit)
            if (i == 1) {
                // A single bad response token cannot qualify a complete band.
                assertNotNull(found)
                val read = ladder().copy(verifiedOi = found)
                assertTrue(read.rankOi(state(), read.rows, 7, "CE") { it.ce }.values.isEmpty())
            } else assertNull(found)
        }
    }

    @Test fun staleBandAndDifferentIndexRemainBlocked() {
        val (live, audit) = observation()
        val v = parse(live, audit)!!
        val read = ladder().copy(verifiedOi = v)
        assertTrue(read.rankOi(state(90_001), read.rows, 7, "CE") { it.ce }.values.isEmpty())
        assertTrue(read.rankOi(state().copy(selected = MarketIndex.SENSEX),
            read.rows, 7, "CE") { it.ce }.values.isEmpty())
    }
}

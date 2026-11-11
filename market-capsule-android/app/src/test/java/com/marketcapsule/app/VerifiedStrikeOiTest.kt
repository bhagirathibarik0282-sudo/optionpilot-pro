package com.marketcapsule.app

import java.time.Instant
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class VerifiedStrikeOiTest {
    private val at = "2026-11-11T04:30:00Z"
    private val wall = Instant.parse(at).toEpochMilli()
    private val expiry = "2026-11-17"
    private val symbol = MarketIndex.NIFTY

    private fun row(strike: Double, side: String, token: Int): JSONObject =
        JSONObject().put("symbol", symbol.name).put("expiry", expiry)
            .put("strike", strike).put("side", side).put("token", token)
            .put("oi", (token * 100).toLong()).put("sourceAt", at)

    private fun source(): JSONObject {
        val observations = JSONArray()
        for (i in 0 until 15) {
            val strike = 25000.0 + i * 50
            observations.put(row(strike, "CE", i + 1))
            observations.put(row(strike, "PE", i + 101))
        }
        val pcr = JSONObject().put("source", "KITE_REST_FULL_EXPIRY_SNAPSHOT")
            .put("state", "COMPLETE").put("fetchState", "OK").put("checkedAt", at)
            .put("coverage", JSONObject().put("expected", 30).put("freshOi", 30)
                .put("complete", true).put("missing", 0).put("stale", 0)
                .put("invalid", 0).put("sourceSkewMs", 0))
            .put("strikeRows", observations)
        val index = JSONObject().put("symbol", symbol.name).put("expiry", expiry)
            .put("pcrSnapshot", pcr)
        val snap = JSONObject().put("tradeDate", "2026-11-11").put("runtimeId", "fixture")
            .put("indices", JSONArray().put(index))
        return JSONObject().put("connected", true).put("source", "KITE_WEBSOCKET_FULL")
            .put("serverTime", at).put("snapshot", snap)
    }

    private fun ladder(): StrikeLadderRead {
        val quotes = JSONArray()
        val old = "2026-11-11T04:27:00Z"
        for (i in 0 until 15) {
            val strike = 25000 + i * 50
            for ((side, token) in listOf("CE" to (i + 1), "PE" to (i + 101))) {
                val identity = JSONObject().put("role", "OPTION").put("symbol", symbol.name)
                    .put("expiry", expiry).put("strike", strike).put("side", side)
                    .put("token", token)
                quotes.put(JSONObject().put("identity", identity).put("state", "STALE")
                    .put("observedAt", old).put("receivedAt", old).put("oi", 999))
            }
        }
        val raw = JSONObject().put("runtimeId", "fixture").put("tradeDate", "2026-11-11")
            .put("rows", quotes).toString()
        return StrikeLadderParser.parse(raw, symbol, expiry, wall, 0)
    }

    private fun state(elapsed: Long = 0, connected: Boolean = true): MarketUiState {
        val quote = Quote(symbol, 25350.0, 0.0, at, at, 0, "LIVE", expiry, 25350.0,
            null, null, null, null)
        val snap = MarketSnapshot("fixture", 1, at, connected, if (connected) "OPEN" else "CLOSED",
            mapOf(symbol to quote))
        return MarketUiState(current = snap, currentElapsedMs = elapsed,
            receivedElapsedMs = elapsed)
    }

    @Test fun fullVerifiedRestExpiryRecoversBothSidesWithoutPromotingStaleWs() {
        val verified = VerifiedStrikeOiParser.parse(source().toString(), symbol, expiry,
            "fixture", wall, 0)
        assertNotNull(verified)
        val read = ladder().copy(verifiedOi = verified)
        assertTrue(read.rows.all { it.ce?.oi == null && it.pe?.oi == null })
        val ce = read.rankOi(state(), read.rows, 7, "CE") { it.ce }
        val pe = read.rankOi(state(), read.rows, 7, "PE") { it.pe }
        assertEquals(15, ce.values.size)
        assertEquals(15, pe.values.size)
        assertEquals("REST_SNAPSHOT", ce.source)
        assertEquals("REST_SNAPSHOT", pe.source)
        assertEquals(100L, ce.values[25000.0])
        assertEquals(10100L, pe.values[25000.0])
        assertTrue(ce.walls.isNotEmpty())
        assertTrue(pe.walls.isNotEmpty())
    }

    @Test fun noCrossContractOrPartialOrStaleExpiryPromotion() {
        val cases = listOf<(JSONObject) -> Unit>(
            { it.getJSONObject("snapshot").put("runtimeId", "other") },
            { it.getJSONObject("snapshot").getJSONArray("indices").getJSONObject(0)
                .put("expiry", "2026-11-24") },
            { it.getJSONObject("snapshot").getJSONArray("indices").getJSONObject(0)
                .getJSONObject("pcrSnapshot").put("state", "INCOMPLETE") },
            { it.getJSONObject("snapshot").getJSONArray("indices").getJSONObject(0)
                .getJSONObject("pcrSnapshot").getJSONArray("strikeRows").remove(1) },
            { it.getJSONObject("snapshot").getJSONArray("indices").getJSONObject(0)
                .getJSONObject("pcrSnapshot").getJSONArray("strikeRows").getJSONObject(1)
                .put("token", 1) },
            { it.getJSONObject("snapshot").getJSONArray("indices").getJSONObject(0)
                .getJSONObject("pcrSnapshot").getJSONArray("strikeRows").getJSONObject(1)
                .put("sourceAt", "2026-11-11T04:28:00Z") }
        )
        for (change in cases) {
            val root = source()
            change(root)
            assertNull(VerifiedStrikeOiParser.parse(root.toString(), symbol, expiry,
                "fixture", wall, 0))
        }
        assertNull(VerifiedStrikeOiParser.parse(source().toString(), symbol, expiry,
            "fixture", wall + 90_001, 0))
    }

    @Test fun verifiedSnapshotExpiresAndIsRevokedOnDisconnectOrIdentityMismatch() {
        val verified = VerifiedStrikeOiParser.parse(source().toString(), symbol, expiry,
            "fixture", wall, 0)
        assertNotNull(verified)
        val read = ladder().copy(verifiedOi = verified)
        assertEquals(15, read.rankOi(state(90_000), read.rows, 7, "CE") { it.ce }.values.size)
        assertTrue(read.rankOi(state(90_001), read.rows, 7, "CE") { it.ce }.values.isEmpty())
        assertTrue(read.rankOi(state(0, connected = false), read.rows, 7, "CE") { it.ce }.values.isEmpty())
        assertTrue(read.rankOi(state().copy(selected = MarketIndex.SENSEX), read.rows, 7, "CE") { it.ce }.values.isEmpty())
        val changed = read.rows.toMutableList()
        val original = changed[0]
        changed[0] = original.copy(ce = original.ce?.copy(token = 999))
        assertTrue(read.rankOi(state(), changed, 7, "CE") { it.ce }.values.isEmpty())
        assertTrue(read.rankOi(state(), changed, 7, "PE") { it.pe }.values.isEmpty())
    }
}

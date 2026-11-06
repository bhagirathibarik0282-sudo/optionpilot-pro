package com.marketcapsule.app

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.time.Instant

class StrikeLadderTest {
    private val now = Instant.parse("2026-11-06T04:30:00Z").toEpochMilli()
    private fun quote(strike: Double, side: String, state: String = "LIVE"): JSONObject = JSONObject()
        .put("identity", JSONObject().put("symbol", "NIFTY").put("role", "OPTION")
            .put("expiry", "2026-11-09").put("side", side).put("strike", strike))
        .put("state", state).put("price", 120.5)
        .put("observedAt", "2026-11-06T04:29:59Z")
        .put("receivedAt", "2026-11-06T04:29:59Z")
    private fun response(rows: JSONArray) = JSONObject().put("runtimeId", "runtime-a")
        .put("tradeDate", "2026-11-06").put("rows", rows).toString()
    private fun parse(rows: JSONArray) = StrikeLadderParser.parse(response(rows),
        MarketIndex.NIFTY, "2026-11-09", now, 1000, 500)

    @Test fun exactPairedStrikesAndBandSelectionAreSourceOnly() {
        val rows = JSONArray()
        (0..14).forEach { i ->
            val k = 24300.0 + i * 50.0
            rows.put(quote(k,"CE")).put(quote(k,"PE"))
        }
        val read = parse(rows)
        assertEquals(15, read.rows.size)
        assertEquals(7, visibleStrikeRows(read.rows, 24650.0, 3).size)
        assertEquals(11, visibleStrikeRows(read.rows, 24650.0, 5).size)
        assertEquals(15, visibleStrikeRows(read.rows, 24650.0, 7).size)
        assertEquals(24650.0, visibleStrikeRows(read.rows, 24650.0, 3)[3].strike, 0.0)
        assertEquals(emptyList<StrikeRow>(), visibleStrikeRows(read.rows, 24900.0, 7))
    }
    @Test fun partialLegAndStaleQuoteStayExplicitlyUnavailable() {
        val read = parse(JSONArray().put(quote(24650.0,"CE"))
            .put(quote(24650.0,"PE","STALE")))
        assertNotNull(read.rows.single().ce?.price)
        assertNull(read.rows.single().pe?.price)
        assertEquals(500L, read.deliveryAgeMs)
    }
    @Test fun wrongIndexExpirySideOrRoleNeverLeak() {
        for ((field, value) in listOf("symbol" to "SENSEX", "expiry" to "2026-11-16",
            "side" to "XX", "role" to "FUTURE")) {
            val q = quote(24650.0,"CE")
            q.getJSONObject("identity").put(field, value)
            val err = assertThrows(IllegalArgumentException::class.java) {
                parse(JSONArray().put(q))
            }
            assertEquals("STRIKE_IDENTITY_MISMATCH", err.message)
        }
    }
    @Test fun duplicateContractAndOldTradingDateFailClosed() {
        assertEquals("STRIKE_DUPLICATE_CONTRACT",
            assertThrows(IllegalArgumentException::class.java) {
                parse(JSONArray().put(quote(24650.0,"CE")).put(quote(24650.0,"CE")))
            }.message)
        val invalid = JSONObject(response(JSONArray().put(quote(24650.0,"CE"))))
            .put("tradeDate","2026-11-05").toString()
        assertEquals("STRIKE_SOURCE_DATE_MISMATCH",
            assertThrows(IllegalArgumentException::class.java) {
                StrikeLadderParser.parse(invalid,MarketIndex.NIFTY,"2026-11-09",now,1000)
            }.message)
    }
    @Test fun exactResponseWithholdsOldOrImpossibleReceipts() {
        val q = quote(24650.0, "CE")
        q.put("receivedAt", "2026-11-06T04:28:00Z")
        assertNull(parse(JSONArray().put(q)).rows.single().ce?.price)
        q.put("receivedAt","2026-11-06T04:29:59Z")
        q.put("observedAt","2026-11-06T04:31:00Z")
        assertNull(parse(JSONArray().put(q)).rows.single().ce?.price)
    }
    @Test fun deviceAndRuntimeAgeRevokeOldPrice() {
        val leg = StrikeOption(150.0, 5000L,"2026-11-06T04:29:55Z")
        val read = StrikeLadderRead(MarketIndex.NIFTY,"2026-11-09","2026-11-06","runtime-a",
            listOf(StrikeRow(24650.0,leg,null)),1000L,1000L)
        val quote = Quote(MarketIndex.NIFTY,24650.0,0.0,null,null,0L,"LIVE",null,null,null,null,null,null)
        val state = MarketUiState(current=MarketSnapshot("runtime-a",1,"2026-11-06T04:30:00Z",true,"OPEN",
            mapOf(MarketIndex.NIFTY to quote)),receivedElapsedMs=1000,currentElapsedMs=2000)
        assertTrue(read.isCurrent(state,leg))
        assertFalse(read.isCurrent(state.copy(currentElapsedMs=40000),leg))
        assertFalse(read.isCurrent(state.copy(selected=MarketIndex.SENSEX),leg))
        assertFalse(read.isCurrent(state.copy(current=state.current!!.copy(runtimeId="runtime-b")),leg))
    }
}

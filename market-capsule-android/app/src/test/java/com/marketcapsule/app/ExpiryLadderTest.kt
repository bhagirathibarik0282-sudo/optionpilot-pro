package com.marketcapsule.app

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.time.Instant

class ExpiryLadderTest {
    private val time = Instant.parse("2026-11-06T04:30:00Z")
    private fun leg(side: String) = JSONObject().put("state", "LIVE").put("price", 125.5).put("changePct", 2.0)
        .put("observedAt", "2026-11-06T04:29:59Z").put("receivedAt", "2026-11-06T04:29:59Z")
        .put("identity", JSONObject().put("symbol", "NIFTY").put("role", "OPTION").put("side", side)
            .put("expiry", "2026-11-09").put("strike", 24650))
    private fun row() = JSONObject().put("expiry", "2026-11-09").put("strike", 24650).put("ce", leg("CE")).put("pe", leg("PE"))
    private fun group(rows: JSONArray) = JSONObject().put("symbol", "NIFTY").put("rows", rows)
    private fun parse(rows: JSONArray) = ExpiryLadderParser.parse(JSONObject().put("atmExpiryLadder", JSONArray().put(group(rows))), time, true)
    @Test fun exactPairRetainsIdentityAndAge() {
        val pair = parse(JSONArray().put(row())).getValue(MarketIndex.NIFTY).single()
        assertEquals("2026-11-09", pair.expiry)
        assertEquals(125.5, pair.ce!!.price, 0.0)
        assertEquals(1000L, pair.ce!!.ageMs)
        assertEquals(125.5, pair.pe!!.price, 0.0)
    }
    @Test fun wrongLegIdentityCannotCrossIndexExpiryStrikeOrSide() {
        for ((field, value) in listOf("symbol" to "SENSEX", "expiry" to "2026-11-17", "strike" to 24700, "side" to "PE")) {
            val r = row()
            r.getJSONObject("ce").getJSONObject("identity").put(field, value)
            val p = parse(JSONArray().put(r)).getValue(MarketIndex.NIFTY).single()
            assertNull(p.ce); assertNotNull(p.pe)
        }
    }
    @Test fun badDatesAndDuplicatesDoNotBecomeEligibleRows() {
        for (date in listOf("2026-11-05", "2026-02-30", "bad")) {
            assertTrue(parse(JSONArray().put(row().put("expiry", date))).getValue(MarketIndex.NIFTY).isEmpty())
        }
        assertNull(parse(JSONArray().put(row()).put(row()))[MarketIndex.NIFTY])
        val g = group(JSONArray().put(row()))
        assertTrue(ExpiryLadderParser.parse(JSONObject().put("atmExpiryLadder", JSONArray().put(g).put(g)), time, true).isEmpty())
    }
    @Test fun staleReceiptAndImpossibleChronologyWithholdOnlyAffectedLeg() {
        for ((key, stamp) in listOf("receivedAt" to "2026-11-06T04:29:20Z", "observedAt" to "2026-11-06T04:30:10Z")) {
            val r = row(); r.getJSONObject("ce").put(key, stamp)
            val p = parse(JSONArray().put(r)).getValue(MarketIndex.NIFTY).single()
            assertNull(p.ce); assertNotNull(p.pe)
        }
    }
    @Test fun deliveryAndElapsedTimeRevokePremiumWithoutRefreshingItsAge() {
        val q = Quote(MarketIndex.NIFTY, 24650.0, 0.0, null, null, 0, "LIVE", null, null, null, null, null, null)
        val state = MarketUiState(current = MarketSnapshot("test", 1, time.toString(), true, "OPEN", mapOf(MarketIndex.NIFTY to q)),
            receivedElapsedMs = 0, currentElapsedMs = 1000, deliveryAgeMs = 2000)
        assertFalse(PremiumLeg(100.0, null, 28_000, time.toString()).eligible(state))
        assertTrue(PremiumLeg(100.0, null, 26_000, time.toString()).eligible(state))
        assertFalse(PremiumLeg(100.0, null, 0, time.toString()).eligible(state.copy(current = null)))
    }
    @Test fun expirySelectionIsExactAndFallsBackToAllWhenSourceRevokesExpiry() {
        val pairs = listOf(
            ExpiryPair("2026-11-09", 24650.0, null, null),
            ExpiryPair("2026-11-16", 24700.0, null, null),
            ExpiryPair("2026-11-23", 24800.0, null, null)
        )
        assertEquals(pairs, visibleExpiryPairs(pairs, "ALL"))
        assertEquals(listOf(pairs[1]), visibleExpiryPairs(pairs, "2026-11-16"))
        assertEquals(pairs, visibleExpiryPairs(pairs, "2026-11-30"))
        assertEquals(emptyList<ExpiryPair>(), visibleExpiryPairs(emptyList(), "2026-11-16"))
    }
    @Test fun missingDisconnectedAndOversizedPanelsStayEmpty() {
        assertTrue(ExpiryLadderParser.parse(JSONObject(), time, true).isEmpty())
        val g = JSONObject().put("atmExpiryLadder", JSONArray().put(group(JSONArray().put(row()))))
        assertTrue(ExpiryLadderParser.parse(g, time, false).isEmpty())
        assertTrue(parse(JSONArray().put(row()).put(row()).put(row()).put(row())).isEmpty())
    }
}

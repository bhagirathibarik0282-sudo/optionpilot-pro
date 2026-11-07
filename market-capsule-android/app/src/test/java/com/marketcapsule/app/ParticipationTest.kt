package com.marketcapsule.app

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class ParticipationTest {
    private val time = "2026-11-05T04:00:00Z"

    private fun quote(token: Int, label: String, price: Double, role: String = "STOCK") = JSONObject()
        .put("identity", JSONObject().put("token", token).put("label", label).put("role", role))
        .put("state", "LIVE").put("price", price).put("pdc", 100)
        .put("observedAt", time).put("receivedAt", time)

    private fun root(rows: JSONArray) = JSONObject().put("source", "KITE_WEBSOCKET_FULL")
        .put("serverTime", time).put("connected", true).put("connectionState", "CONNECTED")
        .put("snapshot", JSONObject().put("runtimeId", "fixture").put("sequence", 1)
            .put("tradeDate", "2026-11-05").put("indices", JSONArray()).put("participation", rows))

    private fun state(root: JSONObject): MarketUiState = MarketUiState(
        current = SnapshotParser.parse(root.toString()), receivedElapsedMs = 0)

    @Test fun normalSnapshotCalculatesChangesFromEachQuotesPreviousClose() {
        val state = state(root(JSONArray().put(quote(1, "STOCK-A", 110.0))
            .put(quote(2, "SECTOR-A", 90.0, "SECTOR"))))
        val participation = state.current!!.participation!!
        assertEquals(2, participation.returnedCount)
        assertEquals(10.0, participation.rows[0].changePct, 1e-9)
        assertEquals(-10.0, participation.rows[1].changePct, 1e-9)
        assertEquals(ParticipationKind.SECTOR, participation.rows[1].kind)
        assertEquals(2, participation.eligible(state).size)
    }

    @Test fun rankingsAreBoundedDeterministicAndSeparateTheTwoGroups() {
        val rows = JSONArray().put(quote(1, "B", 110.0)).put(quote(2, "A", 110.0))
            .put(quote(3, "C", 105.0)).put(quote(4, "D", 104.0))
            .put(quote(5, "FLAT", 100.0)).put(quote(6, "DOWN-A", 90.0))
            .put(quote(7, "DOWN-B", 80.0)).put(quote(8, "SECTOR", 120.0, "SECTOR"))
        val state = state(root(rows))
        val participation = state.current!!.participation!!
        assertEquals(listOf("A", "B", "C"), participation.movers(state, ParticipationKind.STOCK, true).map { it.label })
        assertEquals(listOf("DOWN-B", "DOWN-A"), participation.movers(state, ParticipationKind.STOCK, false).map { it.label })
        assertEquals(listOf("SECTOR"), participation.movers(state, ParticipationKind.SECTOR, true).map { it.label })
        assertEquals(8, participation.eligible(state).size)
    }

    @Test fun invalidBasesIdentityAndChronologyWithholdAffectedRows() {
        val rows = JSONArray()
            .put(quote(1, "ZERO-CLOSE", 110.0).put("pdc", 0))
            .put(quote(2, "STRING-CLOSE", 110.0).put("pdc", "100"))
            .put(quote(3, "MISSING-CLOSE", 110.0).put("pdc", JSONObject.NULL))
            .put(quote(4, "STRING-PRICE", 110.0).put("price", "110"))
            .put(quote(5, "OTHER-ROLE", 110.0, "OPTION"))
            .put(quote(6, "BAD-RECEIPT", 110.0).put("receivedAt", "2026-11-05T04:00:01Z"))
            .put(quote(7, "VALID", 110.0))
        val state = state(root(rows))
        val participation = state.current!!.participation!!
        assertEquals(7, participation.returnedCount)
        assertEquals(listOf("VALID"), participation.rows.map { it.label })
    }

    @Test fun duplicateTokensOrLabelsWithdrawEveryConflictingEntry() {
        val rows = JSONArray().put(quote(1, "FIRST", 110.0))
            .put(quote(1, "SECOND", 111.0).put("pdc", 0))
            .put(quote(2, "SAME-LABEL", 110.0)).put(quote(3, "SAME-LABEL", 111.0))
            .put(quote(4, "VALID-SECTOR", 110.0, "SECTOR"))
        val participation = state(root(rows)).current!!.participation!!
        assertEquals(listOf("VALID-SECTOR"), participation.rows.map { it.label })
    }

    @Test fun quoteAgeIsIndependentAndSavedDisconnectedOrWrongSessionDataCannotBecomeCurrent() {
        val data = root(JSONArray().put(quote(1, "OLDER", 110.0).put("observedAt", "2026-11-05T03:59:31Z"))
            .put(quote(2, "FRESH", 110.0)))
        val initial = state(data)
        val participation = initial.current!!.participation!!
        assertEquals(listOf("FRESH"), participation.eligible(initial.copy(deliveryAgeMs = 2000)).map { it.label })
        assertEquals(2, participation.eligible(initial.copy(selected = MarketIndex.SENSEX)).size)
        for (current in listOf(initial.copy(currentElapsedMs = 5001),
            initial.copy(current = null, saved = initial.current),
            initial.copy(current = initial.current!!.copy(connected = false)))) {
            assertTrue(participation.eligible(current).isEmpty())
        }
        data.getJSONObject("snapshot").put("tradeDate", "2026-11-04")
        assertNull(state(data).current!!.participation)
    }

    @Test fun malformedOrOversizedOptionalParticipationKeepsTheCoreSpot() {
        val bad = quote(1, "BAD", 110.0).put("observedAt", "+999999999-01-01T00:00:00Z")
        val data = root(JSONArray().put(bad))
        val spot = quote(99, "NIFTY 50", 24000.0, "SPOT")
        spot.getJSONObject("identity").put("symbol", "NIFTY")
        data.getJSONObject("snapshot").getJSONArray("indices").put(JSONObject().put("symbol", "NIFTY").put("spot", spot))
        assertEquals(24000.0, state(data).current!!.quotes[MarketIndex.NIFTY]!!.price!!, 0.0)
        assertTrue(state(data).current!!.participation!!.rows.isEmpty())
        data.getJSONObject("snapshot").put("participation", JSONArray().apply { repeat(257) { put(bad) } })
        val result = state(data).current!!
        assertNull(result.participation)
        assertEquals(24000.0, result.quotes[MarketIndex.NIFTY]!!.price!!, 0.0)
    }
}

package com.marketcapsule.app

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class MarketContextTest {
    private fun fixture() = JSONObject("""{
      "source":"KITE_WEBSOCKET_FULL","serverTime":"2026-11-05T04:00:00Z","connected":true,
      "connectionState":"CONNECTED","snapshot":{"runtimeId":"fixture","sequence":1,"tradeDate":"2026-11-05",
        "vix":{"identity":{"role":"VIX","label":"INDIA VIX"},"state":"LIVE","price":16.25,"pdc":16,
          "observedAt":"2026-11-05T04:00:00Z","receivedAt":"2026-11-05T04:00:00Z"},
        "indices":[{"symbol":"BANKNIFTY","spot":{"identity":{"role":"SPOT","symbol":"BANKNIFTY"},
          "state":"LIVE","price":55000,"pdc":54900,"observedAt":"2026-11-05T04:00:00Z",
          "receivedAt":"2026-11-05T04:00:00Z"}}]
      }}""")
    private fun snapshot(root: JSONObject) = root.getJSONObject("snapshot")
    private fun read(root: JSONObject) = SnapshotParser.parse(root.toString())

    @Test fun validContextUsesSourceIdentitiesAndStaysOutsidePrimaryQuotes() {
        val result = read(fixture())
        assertEquals(16.25, result.marketContext.indiaVix!!.price, 0.0)
        assertEquals(55000.0, result.marketContext.bankNiftySpot!!.price, 0.0)
        assertTrue(result.quotes.isEmpty())
    }

    @Test fun wrongVixLabelOrRoleDoesNotEraseBankNifty() {
        for ((key, value) in listOf("label" to "OTHER VIX", "role" to "SPOT")) {
            val root = fixture()
            snapshot(root).getJSONObject("vix").getJSONObject("identity").put(key, value)
            val context = read(root).marketContext
            assertNull(context.indiaVix)
            assertNotNull(context.bankNiftySpot)
        }
    }

    @Test fun conflictingBankRowsAndWrongSpotIdentityOnlyWithholdBankNifty() {
        val duplicate = fixture()
        val rows = snapshot(duplicate).getJSONArray("indices")
        rows.put(rows.getJSONObject(0))
        val foreign = fixture()
        snapshot(foreign).getJSONArray("indices").getJSONObject(0).getJSONObject("spot")
            .getJSONObject("identity").put("symbol", "NIFTY")
        for (root in listOf(duplicate, foreign)) {
            val context = read(root).marketContext
            assertNull(context.bankNiftySpot)
            assertNotNull(context.indiaVix)
        }
    }

    @Test fun staleVixDoesNotEraseFreshBankNifty() {
        val root = fixture()
        snapshot(root).getJSONObject("vix").put("observedAt", "2026-11-05T03:59:29Z")
        val context = read(root).marketContext
        assertNull(context.indiaVix)
        assertNotNull(context.bankNiftySpot)
    }

    @Test fun disconnectedOrWrongSessionCannotSupplyMarketContext() {
        val wrongDate = fixture()
        snapshot(wrongDate).put("tradeDate", "2026-11-04")
        for (root in listOf(wrongDate, fixture().put("connected", false))) {
            val context = read(root).marketContext
            assertNull(context.indiaVix)
            assertNull(context.bankNiftySpot)
        }
    }
}

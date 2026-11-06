package com.marketcapsule.app

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class AuditRegressionTest {
    private fun fixture(): JSONObject = JSONObject("""{
      "source":"KITE_WEBSOCKET_FULL","connected":true,"connectionState":"OPEN",
      "serverTime":"2026-11-06T04:30:00Z",
      "snapshot":{"runtimeId":"audit","sequence":1,"indices":[{
        "symbol":"NIFTY","expiry":"2026-11-09","strike":24000,
        "spot":{"identity":{"symbol":"NIFTY","role":"SPOT"},"state":"LIVE","price":24001,
          "observedAt":"2026-11-06T04:29:59Z","receivedAt":"2026-11-06T04:29:59Z"},
        "ce":{"identity":{"symbol":"NIFTY","role":"OPTION","expiry":"2026-11-09","strike":24000,"side":"CE"},
          "state":"LIVE","price":123,"observedAt":"2026-11-06T04:29:59Z","receivedAt":"2026-11-06T04:29:59Z"}
      }]}}
    """)
    private fun row(j: JSONObject) = j.getJSONObject("snapshot").getJSONArray("indices").getJSONObject(0)
    @Test fun receiptAgeAlsoExpiresSpotAfterDelivery() {
        val j=fixture(); val spot=row(j).getJSONObject("spot")
        spot.put("observedAt","2026-11-06T04:29:35Z").put("receivedAt","2026-11-06T04:29:31Z")
        val snapshot=SnapshotParser.parse(j.toString())
        val state=MarketUiState(current=snapshot,receivedElapsedMs=0,deliveryAgeMs=2000)
        assertEquals(29000L,snapshot.quotes.getValue(MarketIndex.NIFTY).sourceAgeMs)
        assertEquals(ReadingStatus.STALE,state.status)
    }
    @Test fun receiptAgeAlsoExpiresOptionAfterDelivery() {
        val j=fixture(); val ce=row(j).getJSONObject("ce")
        ce.put("observedAt","2026-11-06T04:29:35Z").put("receivedAt","2026-11-06T04:29:31Z")
        val q=SnapshotParser.parse(j.toString()).quotes.getValue(MarketIndex.NIFTY)
        assertEquals(123.0,q.cePrice!!,0.0)
        assertEquals(29000L,q.ceAgeMs)
        assertTrue(q.ceAgeMs!!+2000>QUOTE_MAX_AGE_MS)
    }
    @Test fun observationCannotBeFarNewerThanReceipt() {
        val j=fixture();row(j).getJSONObject("spot").put("receivedAt","2026-11-06T04:29:40Z")
        assertNull(SnapshotParser.parse(j.toString()).quotes.getValue(MarketIndex.NIFTY).price)
    }
    @Test fun optionObservationCannotBeFarNewerThanReceipt() {
        val j=fixture();row(j).getJSONObject("ce").put("receivedAt","2026-11-06T04:29:40Z")
        assertNull(SnapshotParser.parse(j.toString()).quotes.getValue(MarketIndex.NIFTY).cePrice)
    }
    @Test fun invalidAndPastExpiriesNeverSupplyPremium() {
        for (expiry in listOf("not-a-date","2026-02-30","2026-11-05")) {
            val j=fixture();val r=row(j);r.put("expiry",expiry)
            r.getJSONObject("ce").getJSONObject("identity").put("expiry",expiry)
            val q=SnapshotParser.parse(j.toString()).quotes.getValue(MarketIndex.NIFTY)
            assertNotNull(q.price);assertNull(q.expiry);assertNull(q.cePrice)
        }
    }
    @Test(expected=IllegalArgumentException::class) fun incompleteFirstDuplicateCannotHideAmbiguity() {
        val j=fixture();val rows=j.getJSONObject("snapshot").getJSONArray("indices")
        val valid=JSONObject(rows.getJSONObject(0).toString())
        rows.put(0,JSONObject("""{"symbol":"NIFTY"}"""));rows.put(valid)
        SnapshotParser.parse(j.toString())
    }
}

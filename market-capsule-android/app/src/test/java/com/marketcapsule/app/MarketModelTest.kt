package com.marketcapsule.app

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class MarketModelTest {
    private fun fixture(): JSONObject = JSONObject("""{
      "source":"KITE_WEBSOCKET_FULL","connected":true,"connectionState":"OPEN",
      "serverTime":"2026-11-05T04:30:01Z",
      "snapshot":{"runtimeId":"epoch-a","sequence":5,"indices":[{
        "symbol":"NIFTY","expiry":"2026-11-09","strike":24100,
        "spot":{"identity":{"symbol":"NIFTY","role":"SPOT"},"state":"LIVE","price":24120,"changePct":0.5,
          "observedAt":"2026-11-05T04:30:00Z","receivedAt":"2026-11-05T04:30:00Z"},
        "ce":{"identity":{"symbol":"NIFTY","role":"OPTION","expiry":"2026-11-09","strike":24100,"side":"CE"},
          "state":"LIVE","price":150,"observedAt":"2026-11-05T04:30:00Z","receivedAt":"2026-11-05T04:30:00Z"}
      }]}}
    """)
    private fun row(j: JSONObject) = j.getJSONObject("snapshot").getJSONArray("indices").getJSONObject(0)
    @Test fun validSnapshotPreservesExactIdentityAndNullMissingLeg() {
        val q = SnapshotParser.parse(fixture().toString()).quotes.getValue(MarketIndex.NIFTY)
        assertEquals(24120.0, q.price!!, 0.0)
        assertEquals(150.0, q.cePrice!!, 0.0)
        assertNull(q.pePrice)
    }
    @Test fun wrongExpiryCannotSupplyCurrentPremium() {
        val j = fixture()
        row(j).getJSONObject("ce").getJSONObject("identity").put("expiry", "2026-11-16")
        assertNull(SnapshotParser.parse(j.toString()).quotes.getValue(MarketIndex.NIFTY).cePrice)
    }
    @Test fun staleAndDisconnectedSourcesCannotSupplyPrices() {
        val j = fixture().put("connected", false)
        assertNull(SnapshotParser.parse(j.toString()).quotes.getValue(MarketIndex.NIFTY).price)
        val stale = fixture()
        row(stale).getJSONObject("spot").put("observedAt", "2026-11-05T04:29:00Z")
        assertNull(SnapshotParser.parse(stale.toString()).quotes.getValue(MarketIndex.NIFTY).price)
    }
    @Test fun zeroPriceIsUnavailableNotRealQuote() {
        val j = fixture()
        row(j).getJSONObject("spot").put("price", 0)
        assertNull(SnapshotParser.parse(j.toString()).quotes.getValue(MarketIndex.NIFTY).price)
    }
    @Test fun savedSnapshotNeverPromotesItselfToCurrent() {
        val snapshot = SnapshotParser.parse(fixture().toString())
        assertEquals(ReadingStatus.CACHED, MarketUiState(saved = snapshot).status)
    }
    @Test fun localAgeRevokesRecentSnapshot() {
        val snapshot = SnapshotParser.parse(fixture().toString())
        val state = MarketUiState(current = snapshot, receivedElapsedMs = 1000, currentElapsedMs = 1001)
        assertEquals(ReadingStatus.RECENT_SNAPSHOT, state.status)
        assertEquals(ReadingStatus.STALE, state.copy(currentElapsedMs = 7000).status)
    }
    @Test fun backwardsSequenceRejectedButNewEpochAllowedWithNewerTime() {
        val old = SnapshotParser.parse(fixture().toString())
        assertFalse(SnapshotParser.accepts(old, old.copy(sequence = 4)))
        assertTrue(SnapshotParser.accepts(old, old.copy(runtimeId = "epoch-b", sequence = 1, serverTime = "2026-11-05T04:30:02Z")))
        assertFalse(SnapshotParser.accepts(old, old.copy(runtimeId = "epoch-b", serverTime = "2026-11-05T04:29:00Z")))
    }
    @Test(expected = IllegalArgumentException::class) fun duplicateIndexRejected() {
        val j = fixture()
        j.getJSONObject("snapshot").getJSONArray("indices").put(row(j))
        SnapshotParser.parse(j.toString())
    }
    @Test(expected = IllegalArgumentException::class) fun foreignSourceRejected() {
        SnapshotParser.parse(fixture().put("source", "UNKNOWN").toString())
    }
}

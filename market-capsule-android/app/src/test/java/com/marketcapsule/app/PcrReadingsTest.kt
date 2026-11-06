package com.marketcapsule.app

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.time.Instant

class PcrReadingsTest {
    private val server = Instant.parse("2026-11-05T04:30:01Z")
    private fun fixture(): JSONObject = JSONObject("""{
      "tradeDate":"2026-11-05","indices":[{"symbol":"NIFTY","expiry":"2026-11-09",
      "pcrSnapshot":{"source":"KITE_REST_FULL_EXPIRY_SNAPSHOT","fetchState":"OK","state":"COMPLETE",
        "checkedAt":"2026-11-05T04:30:00Z","cycleStartedAt":"2026-11-05T04:29:58Z",
        "sourceMinAt":"2026-11-05T04:29:50Z","sourceMaxAt":"2026-11-05T04:30:00Z",
        "fullPcr":1.5,"ceTotal":100,"peTotal":150,
        "coverage":{"expected":2,"freshOi":2,"complete":true,"missing":0,"invalid":0,"stale":0,"sourceSkewMs":10000},
        "reportedPcr":{"basis":"LATEST_REPORTED_MIXED_TIMESTAMPS","symbol":"NIFTY","expiry":"2026-11-09",
          "checkedAt":"2026-11-05T04:30:00Z","sourceMinAt":"2026-11-05T04:29:50Z",
          "sourceMaxAt":"2026-11-05T04:30:00Z","value":1.5,"ceTotal":100,"peTotal":150,
          "expected":2,"reported":2,"olderThan30s":0}}}]}
    """)
    private fun q(s: JSONObject) = s.getJSONArray("indices").getJSONObject(0).getJSONObject("pcrSnapshot")
    private fun reading(s: JSONObject = fixture()) = PcrReadingParser.parse(s, server, true)[MarketIndex.NIFTY]
    private fun state(p: PcrReading, delivery: Long = 0, elapsed: Long = 0): MarketUiState = MarketUiState(
        current = MarketSnapshot("r", 1, server.toString(), true, "OPEN", emptyMap(), pcrReadings = mapOf(MarketIndex.NIFTY to p)),
        receivedElapsedMs = 1000, currentElapsedMs = 1000 + elapsed, deliveryAgeMs = delivery)

    @Test fun verifiedAndReportedRemainSeparateAndDoNotNeedEligibleSpot() {
        val p = reading()!!
        assertEquals(1.5, p.full!!.ratio, 0.0)
        assertEquals(1.5, p.reported!!.ratio, 0.0)
        assertNull(p.band)
        assertEquals(ReadingStatus.UNAVAILABLE, state(p).status)
        assertTrue(p.eligible(state(p)))
    }
    @Test fun optionalPcrFailureCannotEraseAValidSpotSnapshot() {
        val snapshot = fixture()
        val row = snapshot.getJSONArray("indices").getJSONObject(0)
        row.put("spot", JSONObject()
            .put("identity", JSONObject().put("symbol", "NIFTY").put("role", "SPOT"))
            .put("state", "LIVE").put("price", 24000)
            .put("observedAt", "2026-11-05T04:30:00Z").put("receivedAt", "2026-11-05T04:30:00Z"))
        val root = JSONObject().put("source", "KITE_WEBSOCKET_FULL").put("connected", true)
            .put("serverTime", server.toString()).put("snapshot", snapshot.put("runtimeId", "r").put("sequence", 1))
        assertEquals(1.5, SnapshotParser.parse(root.toString()).pcrReadings[MarketIndex.NIFTY]!!.full!!.ratio, 0.0)
        q(snapshot).put("source", "UNKNOWN")
        val parsed = SnapshotParser.parse(root.toString())
        assertTrue(parsed.pcrReadings.isEmpty())
        assertEquals(24000.0, parsed.quotes[MarketIndex.NIFTY]!!.price!!, 0.0)
    }
    @Test fun missingCoverageWithholdsFullWithoutRemovingReported() {
        val s = fixture()
        q(s).getJSONObject("coverage").put("complete", false).put("freshOi", 1).put("stale", 1)
        q(s).put("state", "INCOMPLETE")
        assertNull(reading(s)!!.full)
        assertNotNull(reading(s)!!.reported)
        q(s).getJSONObject("coverage").put("missing", 1)
        assertNull(reading(s)!!.reported)
    }
    @Test fun zeroPeOiIsARealZeroRatio() {
        val s = fixture(); q(s).put("peTotal", 0).put("fullPcr", 0)
        q(s).getJSONObject("reportedPcr").put("peTotal", 0).put("value", 0)
        assertEquals(0.0, reading(s)!!.full!!.ratio, 0.0)
        q(s).put("ceTotal", 0)
        assertNull(reading(s)!!.full)
    }
    @Test fun malformedNumbersAndRatioMismatchAreNotDisplayed() {
        for (patch in listOf("100", -1, 1.5)) {
            val s = fixture(); q(s).put("ceTotal", patch)
            assertNull(reading(s)!!.full)
        }
        val s = fixture(); q(s).put("fullPcr", 9)
        assertNull(reading(s)!!.full)
        assertNotNull(reading(s)!!.reported)
    }
    @Test fun conflictingTotalsFromTheSameAttemptAreWithheld() {
        val s = fixture()
        q(s).getJSONObject("reportedPcr").put("peTotal", 180).put("value", 1.8)
        val p = reading(s)!!
        assertNull(p.full)
        assertNull(p.reported)
        assertTrue(p.sourceReason.contains("disagree"))
    }
    @Test fun sourceSessionAndExpiryAreChecked() {
        assertTrue(PcrReadingParser.parse(fixture().put("tradeDate", "2026-11-04"), server, true).isEmpty())
        for (expiry in listOf("2026-11-04", "2026-11-31", "2026-1-9")) {
            val s = fixture(); s.getJSONArray("indices").getJSONObject(0).put("expiry", expiry)
            assertNull(reading(s))
        }
    }
    @Test fun reportedIdentityCannotCrossIndexOrExpiry() {
        for ((key, value) in listOf("symbol" to "SENSEX", "expiry" to "2026-11-16")) {
            val s = fixture(); q(s).getJSONObject("reportedPcr").put(key, value)
            assertNull(reading(s)!!.reported)
            assertNotNull(reading(s)!!.full)
        }
    }
    @Test fun oldOiMayOnlyAppearAsExplicitReportedContext() {
        val s = fixture(); val p = q(s)
        p.put("state", "INCOMPLETE").put("sourceMinAt", "2026-11-05T04:00:00Z")
        p.getJSONObject("coverage").put("complete", false).put("freshOi", 0).put("stale", 2)
        p.getJSONObject("reportedPcr").put("sourceMinAt", "2026-11-05T04:00:00Z").put("olderThan30s", 2)
        assertNull(reading(s)!!.full)
        assertEquals(2, reading(s)!!.reported!!.olderAtCheck)
        p.getJSONObject("reportedPcr").put("sourceMinAt", "2026-11-04T04:00:00Z")
        assertNull(reading(s)!!.reported)
    }
    @Test fun cycleAndSourceChronologyAreChecked() {
        for ((key, value) in listOf("checkedAt" to "2026-11-05T04:31:00Z",
            "checkedAt" to "2026-11-05T04:28:00Z", "cycleStartedAt" to "2026-11-05T04:30:01Z")) {
            val s = fixture(); q(s).put(key, value); assertNull(reading(s))
        }
        val s = fixture(); q(s).put("sourceMaxAt", "2026-11-05T04:31:00Z")
        assertNull(reading(s)!!.full)
    }
    @Test fun deliveryElapsedDisconnectAndCacheCannotPromoteAReading() {
        val p = reading()!!
        assertTrue(p.eligible(state(p, delivery = 1000, elapsed = 88_000)))
        assertFalse(p.eligible(state(p, delivery = 1001, elapsed = 88_000)))
        assertFalse(p.eligible(state(p).copy(selected = MarketIndex.SENSEX)))
        assertFalse(p.eligible(state(p).copy(current = state(p).current!!.copy(connected = false))))
        assertFalse(p.eligible(state(p).copy(current = null, saved = state(p).current)))
    }
    @Test fun disconnectedOrFailedFetchWithholdsAllPcrValues() {
        assertTrue(PcrReadingParser.parse(fixture(), server, false).isEmpty())
        for ((key, value) in listOf("fetchState" to "RATE_LIMITED", "source" to "UNKNOWN", "state" to "STALE")) {
            val s = fixture(); q(s).put(key, value); assertNull(reading(s))
        }
    }
    private fun bandFixture(): JSONObject {
        val s = fixture(); val p = q(s)
        p.put("state", "INCOMPLETE").remove("reportedPcr")
        p.getJSONObject("coverage").put("expected", 32).put("freshOi", 30).put("complete", false).put("missing", 2)
        val b = JSONObject().put("state", "COMPLETE").put("halfWidth", 7).put("strikeCount", 15)
            .put("expected", 30).put("freshOi", 30).put("anchorStrike", 24000)
            .put("fromStrike", 23650).put("toStrike", 24350).put("anchorAt", "2026-11-05T04:30:00Z")
            .put("sourceMinAt", "2026-11-05T04:29:50Z").put("sourceMaxAt", "2026-11-05T04:30:00Z")
            .put("ceTotal", 1500).put("peTotal", 4500).put("value", 3)
            .put("strikes", JSONArray((0 until 15).map { 23650 + it * 50 }))
        p.put("bandPcr", b); return s
    }
    @Test fun completeBandDoesNotSubstituteForIncompleteFullInventory() {
        val p = reading(bandFixture())!!
        assertNull(p.full)
        assertEquals(3.0, p.band!!.ratio, 0.0)
        assertEquals(24000.0, p.band!!.anchorStrike!!, 0.0)
    }
    @Test fun wrongBandMembershipOrInsufficientParentCountWithholdsBandOnly() {
        for ((key, value) in listOf("anchorStrike" to 24050, "halfWidth" to 3, "freshOi" to 29)) {
            val s = bandFixture(); q(s).getJSONObject("bandPcr").put(key, value)
            assertNull(reading(s)!!.band)
        }
        val s = bandFixture(); q(s).getJSONObject("coverage").put("expected", 2).put("freshOi", 2)
        assertNull(reading(s)!!.band)
    }
}

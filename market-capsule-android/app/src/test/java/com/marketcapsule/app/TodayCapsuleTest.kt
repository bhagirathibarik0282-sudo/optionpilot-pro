package com.marketcapsule.app

import org.junit.Assert.*
import org.junit.Test

class TodayCapsuleTest {
    private val time = "2026-11-05T04:00:00Z"
    private fun state(change: Double? = 0.5): MarketUiState {
        val quote = Quote(MarketIndex.NIFTY, 24000.0, change, time, time, 0,
            "LIVE", null, null, null, null, null, null)
        return MarketUiState(current = MarketSnapshot("fixture", 1, time, true,
            "CONNECTED", mapOf(MarketIndex.NIFTY to quote)), receivedElapsedMs = 0)
    }
    private fun reading(full: Boolean = true, band: Boolean = false, reported: Boolean = false,
                        ratio: Double = 1.5) = PcrReading(MarketIndex.NIFTY, "2026-11-09", time,
        0, 200, 200,
        if (full) PcrValue(ratio, 100.0, 100 * ratio, time, time) else null,
        if (band) PcrValue(ratio, 100.0, 100 * ratio, time, time) else null,
        if (reported) PcrValue(ratio, 100.0, 100 * ratio, time, time, olderAtCheck = 2) else null,
        "Unavailable")
    private fun withPcr(s: MarketUiState, p: PcrReading) = s.copy(current = s.current!!.copy(
        pcrReadings = mapOf(MarketIndex.NIFTY to p)))

    @Test fun dayChangeKeepsItsOriginalBaselineAndObservationTime() {
        val c = TodayCapsuleComposer.compose(state())
        assertEquals(0.5, c.dayChangePct!!, 0.0)
        assertEquals(time, c.spotObservedAt)
        assertTrue(c.watchNext.first().contains("above broker previous close"))
        assertNull(c.pcr)
    }
    @Test fun negativeAndFlatReadingsHaveDifferentWatchConditions() {
        assertTrue(TodayCapsuleComposer.compose(state(-0.5)).watchNext.first().contains("below broker previous close"))
        val flat = TodayCapsuleComposer.compose(state(0.0))
        assertEquals(0.0, flat.dayChangePct!!, 0.0)
        assertTrue(flat.watchNext.first().contains("above or below"))
    }
    @Test fun missingOrNonfiniteChangeDoesNotBecomeZero() {
        for (value in listOf(null, Double.NaN, Double.POSITIVE_INFINITY)) {
            val c = TodayCapsuleComposer.compose(state(value))
            assertNull(c.dayChangePct)
            assertTrue(c.hasObservation)
        }
    }
    @Test fun savedDisconnectedAndOldSpotNeverBecomeCurrentFacts() {
        val live = state()
        val cases = listOf(live.copy(current = null, saved = live.current),
            live.copy(current = live.current!!.copy(connected = false)),
            live.copy(currentElapsedMs = 5001), live.copy(deliveryAgeMs = 30001))
        for (s in cases) {
            val c = TodayCapsuleComposer.compose(s)
            assertNull(c.dayChangePct)
            assertNull(c.spotObservedAt)
            assertFalse(c.hasObservation)
        }
    }
    @Test fun invalidPriceCannotProduceAChangeClaim() {
        val s = state()
        for (price in listOf(0.0, -1.0, Double.NaN)) {
            val q = s.quote!!.copy(price = price)
            val c = TodayCapsuleComposer.compose(s.copy(current = s.current!!.copy(
                quotes = mapOf(MarketIndex.NIFTY to q))))
            assertNull(c.dayChangePct)
        }
    }
    @Test fun pcrUsesItsOwnClockWhenSpotHasExpired() {
        val c = TodayCapsuleComposer.compose(withPcr(state(), reading()).copy(currentElapsedMs = 6000))
        assertNull(c.dayChangePct)
        assertNotNull(c.pcr?.full)
        assertTrue(c.hasObservation)
    }
    @Test fun zeroPcrIsNumericAndReportedNeverReplacesFull() {
        val zero = TodayCapsuleComposer.compose(withPcr(state(), reading(ratio = 0.0)))
        assertEquals(0.0, zero.pcr!!.full!!.ratio, 0.0)
        val mixed = TodayCapsuleComposer.compose(withPcr(state(), reading(full = false, reported = true)))
        assertNull(mixed.pcr!!.full)
        assertNotNull(mixed.pcr.reported)
        assertTrue(mixed.watchNext.last().contains("mixed source times"))
    }
    @Test fun bandIsNotPresentedAsFullInventory() {
        val c = TodayCapsuleComposer.compose(withPcr(state(), reading(full = false, band = true)))
        assertNull(c.pcr!!.full)
        assertNotNull(c.pcr.band)
        assertTrue(c.watchNext.last().contains("only its strike band"))
    }
    @Test fun pcrCannotCrossIndexCacheOrExpiryBudget() {
        val live = withPcr(state(), reading())
        for (s in listOf(live.copy(selected = MarketIndex.SENSEX),
            live.copy(current = null, saved = live.current), live.copy(currentElapsedMs = 90001),
            live.copy(current = live.current!!.copy(connected = false)),
            live.copy(currentElapsedMs = 89000, deliveryAgeMs = 1001))) {
            assertNull(TodayCapsuleComposer.compose(s).pcr)
        }
    }
    @Test fun missingFamiliesRetainOnlySupportedObservations() {
        val blank = TodayCapsuleComposer.compose(MarketUiState())
        assertFalse(blank.hasObservation)
        assertEquals(2, blank.watchNext.size)
        val s = state()
        val pcrOnly = withPcr(s.copy(current = s.current!!.copy(quotes = emptyMap())), reading())
        val c = TodayCapsuleComposer.compose(pcrOnly)
        assertNull(c.dayChangePct)
        assertTrue(c.hasObservation)
        assertNotNull(c.pcr?.full)
    }
}

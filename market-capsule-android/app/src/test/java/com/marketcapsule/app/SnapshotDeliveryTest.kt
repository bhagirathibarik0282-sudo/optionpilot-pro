package com.marketcapsule.app

import org.junit.Assert.*
import org.junit.Test
import java.time.Instant

class SnapshotDeliveryTest {
    private val server = "2026-11-06T04:30:00Z"
    private val wall = Instant.parse(server).toEpochMilli()
    @Test fun usesConservativeMaximumWithoutDoubleCountingTwoDeliveryEstimates() {
        assertEquals(2000L, SnapshotDelivery.ageBudget(server, wall + 1000, 2000))
        assertEquals(4000L, SnapshotDelivery.ageBudget(server, wall + 4000, 2000))
    }
    @Test(expected = IllegalArgumentException::class) fun rejectsOldEnvelopeEvenIfItsQuotesLookFreshRelativeToIt() {
        SnapshotDelivery.ageBudget(server, wall + 86_400_000, 200)
    }
    @Test(expected = IllegalArgumentException::class) fun clockMismatchDoesNotPromoteFutureEnvelope() {
        SnapshotDelivery.ageBudget(server, wall - 5001, 200)
    }
    @Test fun toleratesSmallClockSkewConservatively() {
        assertEquals(500L, SnapshotDelivery.ageBudget(server, wall - 3000, 500))
    }
    @Test fun transitCanExpireQuoteBeforeItIsShown() {
        val q = Quote(MarketIndex.NIFTY, 24000.0, null, server, server, 28_000,
            "LIVE", null, null, null, null, null, null)
        val snapshot = MarketSnapshot("fixture", 1, server, true, "OPEN", mapOf(MarketIndex.NIFTY to q))
        val state = MarketUiState(current = snapshot, receivedElapsedMs = 1000, currentElapsedMs = 1000)
        assertEquals(ReadingStatus.RECENT_SNAPSHOT, state.status)
        assertEquals(ReadingStatus.STALE, state.copy(deliveryAgeMs = 3000).status)
        assertEquals(ReadingStatus.CACHED, MarketUiState(saved = snapshot, deliveryAgeMs = 3000).status)
    }
    @Test(expected = IllegalArgumentException::class) fun rejectsInvalidMonotonicDuration() {
        SnapshotDelivery.ageBudget(server, wall, -1)
    }
}

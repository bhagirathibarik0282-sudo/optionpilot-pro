package com.marketcapsule.app

import android.app.Application
import android.os.SystemClock
import androidx.test.core.app.ApplicationProvider
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import java.io.IOException
import java.time.Instant
import java.util.concurrent.atomic.AtomicInteger
import org.junit.After
import org.junit.Assert.*
import org.junit.Test

class LiveLifecycleTest {
    private var vm: MarketViewModel? = null
    private fun main(block: () -> Unit) = InstrumentationRegistry.getInstrumentation().runOnMainSync { block() }
    private fun waitFor(predicate: () -> Boolean) {
        val deadline = SystemClock.elapsedRealtime() + 7000
        while (!predicate() && SystemClock.elapsedRealtime() < deadline) Thread.sleep(20)
        assertTrue("Timed out waiting for lifecycle state", predicate())
    }
    private class FakeSource(val failFirst: Boolean = false, val blocked: Boolean = false, val rewindOnRetry: Boolean = false) : MarketSource {
        val active = AtomicInteger(); val maximum = AtomicInteger(); val starts = AtomicInteger()
        override suspend fun loadSaved(): MarketSnapshot? = null
        override suspend fun fetch(): FetchedSnapshot = error("Manual fetch not expected")
        override suspend fun save(raw: String) = true
        override suspend fun ensureRuntime() { if (blocked) error("APP_AUTHENTICATION_REQUIRED") }
        override fun updates(): Flow<FetchedSnapshot> = flow {
            val n = starts.incrementAndGet()
            val count = active.incrementAndGet(); maximum.updateAndGet { maxOf(it, count) }
            try {
                val time = Instant.now().toString()
                val quote = Quote(MarketIndex.NIFTY, 24000.0, null, time, time, 0, "LIVE", null, null, null, null, null, null)
                val snapshot = MarketSnapshot("fixture", if (rewindOnRetry) 10L - n else n.toLong(), time, true, "OPEN", mapOf(MarketIndex.NIFTY to quote))
                emit(FetchedSnapshot(snapshot, "fixture-only", SystemClock.elapsedRealtime(), 0, null))
                if (failFirst && n == 1) throw IOException("NETWORK_UNAVAILABLE")
                awaitCancellation()
            } finally { active.decrementAndGet() }
        }
    }
    private fun create(source: FakeSource): MarketViewModel {
        main { vm = MarketViewModel(ApplicationProvider.getApplicationContext<Application>(), source) }
        return vm!!
    }
    @After fun stop() { main { vm?.setUpdatesWanted(false); vm?.setForeground(false) } }

    @Test fun backgroundPauseResumeAndRapidTogglesNeverOverlapCollectors() {
        val source = FakeSource(); val model = create(source)
        main { model.setForeground(true); model.setUpdatesWanted(true) }
        waitFor { source.active.get() == 1 && model.state.value.updatePhase == UpdatePhase.RECEIVING }
        main { model.setForeground(false) }
        waitFor { source.active.get() == 0 }
        assertNull(model.state.value.current)
        assertNotNull(model.state.value.saved)
        assertEquals(UpdatePhase.PAUSED, model.state.value.updatePhase)
        main { model.setForeground(true) }
        waitFor { source.starts.get() == 2 && source.active.get() == 1 }
        main { repeat(8) { model.setForeground(false); model.setForeground(true) } }
        waitFor { source.active.get() == 1 }
        main { model.setUpdatesWanted(false) }
        waitFor { source.active.get() == 0 }
        assertEquals(1, source.maximum.get())
        assertEquals(UpdatePhase.OFF, model.state.value.updatePhase)
    }
    @Test fun disconnectWithholdsCurrentThenReconnectsToNewerSnapshot() {
        val source = FakeSource(failFirst = true); val model = create(source)
        main { model.setForeground(true); model.setUpdatesWanted(true) }
        waitFor { model.state.value.updatePhase == UpdatePhase.RETRY_WAIT }
        assertNull(model.state.value.current)
        assertNotNull(model.state.value.saved)
        waitFor { source.starts.get() == 2 && model.state.value.updatePhase == UpdatePhase.RECEIVING }
        assertEquals(2L, model.state.value.current?.sequence)
        assertEquals(1, source.maximum.get())
    }
    @Test fun authenticationFailureStopsAutomaticRetry() {
        val source = FakeSource(blocked = true); val model = create(source)
        main { model.setForeground(true); model.setUpdatesWanted(true) }
        waitFor { model.state.value.updatePhase == UpdatePhase.BLOCKED }
        assertFalse(model.state.value.updatesWanted)
        assertEquals(0, source.starts.get())
    }
    @Test fun reconnectDoesNotForgetOrderingWatermark() {
        val source = FakeSource(failFirst = true, rewindOnRetry = true); val model = create(source)
        main { model.setForeground(true); model.setUpdatesWanted(true) }
        waitFor { model.state.value.updatePhase == UpdatePhase.BLOCKED }
        assertFalse(model.state.value.updatesWanted)
        assertNull(model.state.value.current)
        assertEquals(9L, model.state.value.saved?.sequence)
        assertTrue(model.state.value.message.contains("Older server response rejected"))
    }

}

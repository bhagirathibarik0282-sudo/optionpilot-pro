package com.marketcapsule.app

import android.app.Application
import android.os.SystemClock
import androidx.test.core.app.ApplicationProvider
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.emptyFlow
import org.junit.After
import org.junit.Assert.*
import org.junit.Test
import java.time.Instant
import java.util.concurrent.atomic.AtomicInteger

/** Synthetic data only; no production requests or broker credentials. */
class ManualLifecycleTest {
    private var model: MarketViewModel? = null
    private fun main(block: () -> Unit) =
        InstrumentationRegistry.getInstrumentation().runOnMainSync { block() }
    private fun waitFor(predicate: () -> Boolean) {
        val deadline = SystemClock.elapsedRealtime() + 7000
        while (!predicate() && SystemClock.elapsedRealtime() < deadline) Thread.sleep(20)
        assertTrue("Timed out waiting for manual lifecycle state", predicate())
    }
    private class Source : MarketSource {
        val calls = AtomicInteger()
        val active = AtomicInteger()
        @Volatile var block = false
        override suspend fun loadSaved(): MarketSnapshot? = null
        override suspend fun ensureRuntime() = Unit
        override fun updates(): Flow<FetchedSnapshot> = emptyFlow()
        override suspend fun save(raw: String) = true
        override suspend fun fetch(): FetchedSnapshot {
            val sequence = calls.incrementAndGet().toLong()
            active.incrementAndGet()
            try {
                if (block) awaitCancellation()
                val time = Instant.now().toString()
                val quote = Quote(MarketIndex.NIFTY, 24000.0 + sequence, null,
                    time, time, 0, "LIVE", null, null, null, null, null, null)
                return FetchedSnapshot(MarketSnapshot("manual-fixture", sequence, time, true,
                    "CONNECTED", mapOf(MarketIndex.NIFTY to quote)), "fixture-only",
                    SystemClock.elapsedRealtime(), 0, null)
            } finally { active.decrementAndGet() }
        }
    }
    private fun create(source: Source): MarketViewModel {
        main { model = MarketViewModel(ApplicationProvider.getApplicationContext<Application>(), source) }
        return model!!
    }
    @After fun stop() { main { model?.setForeground(false) } }

    @Test fun backgroundBlocksManualFetchAndReturnNeedsANewRead() {
        val source = Source()
        val vm = create(source)
        main { vm.refresh() }
        assertEquals(0, source.calls.get())
        main { vm.setForeground(true); vm.refresh() }
        waitFor { vm.state.value.current?.sequence == 1L && !vm.state.value.loading }
        main { vm.setForeground(false) }
        assertNull(vm.state.value.current)
        assertEquals(1L, vm.state.value.saved?.sequence)
        assertFalse(vm.state.value.loading)
        main { vm.refresh(); vm.setForeground(true) }
        assertEquals(1, source.calls.get())
        assertNull(vm.state.value.current)
        main { vm.refresh() }
        waitFor { vm.state.value.current?.sequence == 2L && !vm.state.value.loading }
        assertEquals(2L, vm.state.value.saved?.sequence)
    }

    @Test fun cancelledManualRequestClearsPendingStateAndCanRetry() {
        val source = Source().apply { block = true }
        val vm = create(source)
        main { vm.setForeground(true); vm.refresh() }
        waitFor { source.active.get() == 1 && vm.state.value.loading }
        main { vm.setForeground(false) }
        waitFor { source.active.get() == 0 && !vm.state.value.loading }
        assertNull(vm.state.value.current)
        assertFalse(vm.state.value.message.contains("requesting", ignoreCase = true))
        assertTrue(vm.state.value.message.contains("background"))
        source.block = false
        main { vm.setForeground(true); vm.refresh() }
        waitFor { vm.state.value.current?.sequence == 2L && !vm.state.value.loading }
        assertEquals(2, source.calls.get())
        assertEquals(0, source.active.get())
    }
}

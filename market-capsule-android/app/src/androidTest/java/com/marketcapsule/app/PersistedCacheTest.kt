package com.marketcapsule.app

import android.content.Context
import android.content.ContextWrapper
import androidx.test.core.app.ApplicationProvider
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Before
import org.junit.Assert.*
import org.junit.Test

class PersistedCacheTest {
    private lateinit var root: File
    private lateinit var context: Context
    @Before fun prepare() {
        val app = ApplicationProvider.getApplicationContext<Context>()
        root = File(app.cacheDir,"audit-cache-${System.nanoTime()}").apply { mkdirs() }
        context = object : ContextWrapper(app) { override fun getFilesDir() = root }
    }
    @After fun cleanup() { root.deleteRecursively() }
    private fun fixture() = InstrumentationRegistry.getInstrumentation().context.assets
        .open("audit-cache.json").bufferedReader().use { it.readText() }
    @Test fun savedQuoteSurvivesRepositoryRecreationButNeverBecomesCurrent() = runBlocking {
        assertTrue(MarketRepository(context).save(fixture()))
        val loaded = MarketRepository(context).loadSaved()
        assertNotNull(loaded)
        assertEquals(123.45, loaded!!.quotes.getValue(MarketIndex.NIFTY).price!!,0.0)
        assertEquals(ReadingStatus.CACHED, MarketUiState(saved=loaded).status)
        assertNull(MarketUiState(saved=loaded).current)
    }
    @Test fun corruptCacheIsUnavailableRatherThanInvented() = runBlocking {
        File(root,"last-market-snapshot.json").writeText("broken-json")
        assertNull(MarketRepository(context).loadSaved())
    }
    @Test fun oversizedCacheIsRejected() = runBlocking {
        File(root,"last-market-snapshot.json").outputStream().use { it.write(ByteArray(4*1024*1024+1)) }
        assertNull(MarketRepository(context).loadSaved())
    }
}

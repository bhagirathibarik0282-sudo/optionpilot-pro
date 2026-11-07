package com.marketcapsule.app

import android.content.ContextWrapper
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import java.io.File
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.util.UUID
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class FiiDiiUiTest {
    @get:Rule val ui = createComposeRule()

    @Test fun cashFlowCacheRestoresDatedDataIndependentlyOfMarketSnapshots() = runBlocking {
        val app = InstrumentationRegistry.getInstrumentation().targetContext
        val directory = File(app.cacheDir, "fii-dii-test-${UUID.randomUUID()}")
        check(directory.mkdir())
        val context = object : ContextWrapper(app) {
            override fun getFilesDir(): File = directory
        }
        val fetched = Instant.now().minusSeconds(10)
        val date = fetched.atZone(ZoneId.of("Asia/Kolkata")).toLocalDate().minusDays(1)
        val payload = """{
          "mode":"READ_ONLY_FII_DII_PRODUCTION_READINESS_V1",
          "version":"CANONICAL_FII_DII_PRODUCTION_READINESS_V1",
          "source":"OFFICIAL_NSE","readOnly":true,"contextOnly":true,"mutatesData":false,
          "ok":true,"ready":true,"expectedMarketSessionDate":"$date",
          "latestStoredSessionDate":"$date","dailyHistoryState":"VERIFIED_STORED_EOD",
          "dailyHistory":[{"date":"$date","fetchedAt":"$fetched","source":"NSE_FII_DII",
            "sourceUrl":"https://www.nseindia.com/api/fiidiiTradeReact",
            "fiiNetCrore":-100,"diiNetCrore":150,"combinedNetCrore":50}]
        }"""
        try {
            assertTrue(MarketRepository(context).saveFiiDii(payload))
            val reopened = MarketRepository(context)
            val saved = reopened.loadSavedFiiDii()!!
            assertEquals(date, saved.latest.date)
            assertEquals(50.0, saved.latest.combinedNetCrore, 0.0)
            assertNull(reopened.loadSaved())
        } finally {
            directory.deleteRecursively()
        }
    }

    @Test fun datedCashFlowSurvivesAnUnavailableRefreshAndHasItsOwnButton() {
        val row = FiiDiiCashRow(LocalDate.parse("2026-11-06"), Instant.parse("2026-11-06T15:05:01Z"),
            "https://www.nseindia.com/api/fiidiiTradeReact", -100.0, 150.0, 50.0)
        val state = mutableStateOf(MarketUiState(fiiDii = FiiDiiCashRead(row, row.date, true),
            fiiDiiMessage = "Saved EOD reading."))
        var refreshes = 0
        ui.setContent { MaterialTheme { CapsuleScreen(state.value, {}, {}, onRefreshFiiDii = { refreshes++ }) } }
        val screen = ui.onNodeWithTag("screen-content")
        screen.performScrollToNode(hasTestTag("fii-dii-date"))
        ui.onNodeWithTag("fii-dii-date").assertTextEquals("Trading date: 2026-11-06")
        ui.onNodeWithTag("fii-net").assertTextEquals("FII/FPI net: -100.00")
        ui.onNodeWithTag("dii-net").assertTextEquals("DII net: +150.00")
        screen.performScrollToNode(hasTestTag("fii-dii-refresh"))
        ui.onNodeWithTag("fii-dii-refresh").performClick()
        ui.runOnIdle {
            assertEquals(1, refreshes)
            state.value = state.value.copy(fiiDiiMessage = "Server is outside operating hours.")
        }
        screen.performScrollToNode(hasTestTag("fii-dii-status"))
        ui.onNodeWithTag("fii-dii-status").assertTextEquals("Server is outside operating hours.")
        screen.performScrollToNode(hasTestTag("fii-dii-date"))
        ui.onNodeWithTag("fii-dii-date").assertTextEquals("Trading date: 2026-11-06")
    }
}

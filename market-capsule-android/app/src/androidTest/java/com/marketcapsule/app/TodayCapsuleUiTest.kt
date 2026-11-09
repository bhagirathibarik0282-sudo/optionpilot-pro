package com.marketcapsule.app

import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import org.junit.Rule
import org.junit.Test

/** Synthetic observations verify rendering, not real-market correctness. */
class TodayCapsuleUiTest {
    @get:Rule val ui = createComposeRule()
    private val time = "2026-11-05T04:00:00Z"
    private fun state(): MarketUiState {
        val quote = Quote(MarketIndex.NIFTY, 24000.0, 0.5, time, time, 0,
            "LIVE", null, null, null, null, null, null)
        val mixed = PcrReading(MarketIndex.NIFTY, "2026-11-09", time, 0, 200, 198,
            null, null, PcrValue(1.8, 100.0, 180.0, time, time, olderAtCheck = 2), "Mixed source times")
        return MarketUiState(current = MarketSnapshot("fixture", 1, time, true,
            "CONNECTED", mapOf(MarketIndex.NIFTY to quote), pcrReadings = mapOf(MarketIndex.NIFTY to mixed)),
            receivedElapsedMs = 0)
    }
    @Test fun todayKeepsSourceTimeVisibleAndShowsDiagnosticsOnDemand() {
        ui.setContent { MaterialTheme { CapsuleScreen(state(), {}, {}) } }
        val screen = ui.onNodeWithTag("screen-content")
        val sourceTime = hasText("Source time:", substring = true)
        val serverTime = hasText("Server time:", substring = true)
        val details = hasTestTag("today-quote-details")

        screen.performScrollToNode(sourceTime)
        ui.onNode(sourceTime).assertIsDisplayed()
        ui.onNode(serverTime).assertDoesNotExist()
        screen.performScrollToNode(details)
        ui.onNode(details).performClick()
        screen.performScrollToNode(serverTime)
        ui.onNode(serverTime).assertIsDisplayed()
        screen.performScrollToNode(details)
        ui.onNode(details).performClick()
        ui.onNode(serverTime).assertDoesNotExist()
        ui.onNodeWithTag("tab-DESK").performClick()
        screen.performScrollToNode(serverTime)
        ui.onNode(serverTime).assertIsDisplayed()
        ui.onNode(details).assertDoesNotExist()
    }

    @Test fun capsuleNamesTheBaselineAndDoesNotPromoteReportedPcr() {
        val s = mutableStateOf(state())
        ui.setContent { MaterialTheme { CapsuleScreen(s.value, {}, {}) } }
        ui.onNodeWithTag("screen-content").performScrollToNode(hasTestTag("today-day-change"))
        ui.onNodeWithTag("today-day-change").assertTextEquals("NIFTY: +0.50% versus broker previous close.")
        ui.onNodeWithTag("screen-content").performScrollToNode(hasTestTag("today-full-pcr"))
        ui.onNodeWithTag("today-full-pcr").assertTextEquals("Full PCR · verified: —")
        ui.onNodeWithTag("screen-content").performScrollToNode(hasTestTag("today-reported-pcr"))
        ui.onNodeWithTag("today-reported-pcr").assertTextEquals("Latest reported PCR: 1.8000 · 2026-11-09 · mixed source times")
        ui.onNodeWithTag("today-capsule-status").assertTextEquals("Reported OI only · mixed source times")
        ui.onNodeWithTag("today-pcr-coverage").assertTextEquals("Fresh OI coverage: 198 / 200 contracts")
        ui.onNodeWithTag("today-pcr-checked").assertTextContains("Expiry 2026-11-09 · checked", substring = true)
        ui.runOnIdle { s.value = s.value.copy(currentElapsedMs = 90001) }
        ui.onNodeWithTag("today-reported-pcr").assertDoesNotExist()
        ui.onNodeWithTag("today-pcr-coverage").assertDoesNotExist()
        ui.onNodeWithTag("today-pcr-checked").assertDoesNotExist()
        ui.onNodeWithTag("screen-content").performScrollToNode(hasTestTag("today-day-change"))
        ui.onNodeWithTag("today-day-change").assertTextEquals("Day change unavailable. Refresh for a new observation.")
    }
    @Test fun capsuleExposesEvidenceAndWithdrawsFactsOnIndexSwitch() {
        val s = mutableStateOf(state())
        ui.setContent { MaterialTheme { CapsuleScreen(s.value, { s.value = s.value.copy(selected = it) }, {}) } }
        ui.onNodeWithTag("screen-content").performScrollToNode(hasTestTag("today-evidence-toggle"))
        ui.onNodeWithTag("today-evidence-toggle").performClick()
        ui.onNodeWithTag("screen-content").performScrollToNode(hasText("NIFTY · Kite via existing OptionPilot backend"))
        ui.onNodeWithText("NIFTY · Kite via existing OptionPilot backend").assertIsDisplayed()
        ui.runOnIdle { s.value = s.value.copy(selected = MarketIndex.SENSEX) }
        ui.onNodeWithTag("screen-content").performScrollToNode(hasTestTag("today-day-change"))
        ui.onNodeWithTag("today-day-change").assertTextEquals("Day change unavailable. Refresh for a new observation.")
        ui.onNodeWithTag("screen-content").performScrollToNode(hasTestTag("today-full-pcr"))
        ui.onNodeWithTag("today-full-pcr").assertTextEquals("Full PCR · verified: —")
        ui.onNodeWithTag("screen-content").performScrollToNode(hasTestTag("today-cause"))
        ui.onNodeWithTag("today-cause").assertTextEquals("Market cause unverified. News and historical matching are not connected.")
    }
}

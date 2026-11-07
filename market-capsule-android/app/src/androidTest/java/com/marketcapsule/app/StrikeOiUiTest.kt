package com.marketcapsule.app

import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import org.junit.Rule
import org.junit.Test

class StrikeOiUiTest {
    @get:Rule val ui = createComposeRule()

    @Test fun combinedLadderShowsPremiumAndBandCoverageWithIndependentWalls() {
        val time = "2026-11-06T04:30:00Z"
        val expiry = "2026-11-09"
        val index = MarketIndex.NIFTY
        val rows = (0..6).map { position ->
            val ce = StrikeOption(if (position == 1) 123.45 else 110.0, 0, time,
                if (position == 1 || position == 3) 200 else 100)
            val pe = StrikeOption(105.0, 0, time, if (position == 6) null else 100)
            StrikeRow(23850.0 + position * 50, ce, pe)
        }
        val quote = Quote(index, 24000.0, 0.0, time, time, 0, "LIVE", null, null, null, null, null, null)
        val snapshot = MarketSnapshot("fixture", 1, time, true, "OPEN", mapOf(index to quote),
            ladders = mapOf(index to listOf(ExpiryPair(expiry, 24000.0, null, null))))
        val read = StrikeLadderRead(index, expiry, "2026-11-06", "fixture", rows, 0, 0)
        val state = MarketUiState(current = snapshot, receivedElapsedMs = 0, strikeLadder = read)
        ui.setContent { MaterialTheme { CapsuleScreen(state, {}, {}) } }
        ui.onNodeWithTag("tab-DESK").performClick()
        val screen = ui.onNodeWithTag("screen-content")
        screen.performScrollToNode(hasTestTag("strike-display-BOTH"))
        ui.onNodeWithTag("strike-display-BOTH").performClick()
        screen.performScrollToNode(hasTestTag("strike-oi-coverage"))
        ui.onNodeWithTag("strike-oi-coverage").assertTextEquals("Fresh OI: CE 7/7 · PE 6/7")
        ui.onNodeWithTag("strike-ce-wall").assertTextEquals("Call band wall: 23,900 / 24,000 · OI 200 · tie")
        ui.onNodeWithTag("strike-pe-wall").assertTextEquals("Put band wall: —")
        screen.performScrollToNode(hasText("₹123.45"))
        ui.onNodeWithText("₹123.45").assertExists()
    }
}

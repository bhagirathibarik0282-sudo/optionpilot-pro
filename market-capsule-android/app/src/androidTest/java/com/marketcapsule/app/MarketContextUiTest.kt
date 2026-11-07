package com.marketcapsule.app

import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import org.junit.Rule
import org.junit.Test

class MarketContextUiTest {
    @get:Rule val ui = createComposeRule()

    @Test fun contextRemainsIndependentOfPrimaryIndexAndWithdrawsOldOrSavedValues() {
        val time = "2026-11-05T04:00:00Z"
        val vix = ReferenceQuote(16.25, 16.0, null, null, null, time, time, 29000)
        val bank = ReferenceQuote(55000.0, 54900.0, null, null, null, time, time, 0)
        val snapshot = MarketSnapshot("fixture", 1, time, true, "CONNECTED", emptyMap(),
            marketContext = MarketContext(vix, bank))
        val state = mutableStateOf(MarketUiState(current = snapshot, receivedElapsedMs = 0))
        ui.setContent { MaterialTheme { CapsuleScreen(state.value, {}, {}) } }
        ui.onNodeWithTag("screen-content").performScrollToNode(hasTestTag("context-vix"))
        ui.onNodeWithTag("context-vix").assertTextEquals("India VIX: 16.25")
        ui.onNodeWithTag("screen-content").performScrollToNode(hasTestTag("context-banknifty"))
        ui.onNodeWithTag("context-banknifty").assertTextEquals("BANKNIFTY spot: 55,000.00")
        ui.runOnIdle { state.value = state.value.copy(selected = MarketIndex.SENSEX, deliveryAgeMs = 2000) }
        ui.onNodeWithTag("screen-content").performScrollToNode(hasTestTag("context-vix"))
        ui.onNodeWithTag("context-vix").assertTextEquals("India VIX: —")
        ui.onNodeWithTag("screen-content").performScrollToNode(hasTestTag("context-banknifty"))
        ui.onNodeWithTag("context-banknifty").assertTextEquals("BANKNIFTY spot: 55,000.00")
        ui.runOnIdle { state.value = state.value.copy(current = null, saved = snapshot) }
        ui.onNodeWithTag("screen-content").performScrollToNode(hasTestTag("context-banknifty"))
        ui.onNodeWithTag("context-banknifty").assertTextEquals("BANKNIFTY spot: —")
    }
}

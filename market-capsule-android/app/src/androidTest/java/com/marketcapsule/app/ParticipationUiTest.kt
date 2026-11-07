package com.marketcapsule.app

import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import org.junit.Rule
import org.junit.Test

class ParticipationUiTest {
    @get:Rule val ui = createComposeRule()

    @Test fun sharedTrackedMoversShowCoverageAndWithdrawWhenExpired() {
        val time = "2026-11-05T04:00:00Z"
        val quote = ReferenceQuote(110.0, 100.0, null, null, null, time, time, 0)
        val participation = ParticipationSnapshot(3, listOf(
            ParticipationReading(ParticipationKind.STOCK, 1, "STOCK-A", quote, 10.0),
            ParticipationReading(ParticipationKind.SECTOR, 2, "SECTOR-A", quote, 10.0)))
        val state = mutableStateOf(MarketUiState(current = MarketSnapshot("fixture", 1, time,
            true, "CONNECTED", emptyMap(), participation = participation), receivedElapsedMs = 0))
        ui.setContent { MaterialTheme { CapsuleScreen(state.value, {}, {}) } }
        ui.onNodeWithTag("screen-content").performScrollToNode(hasTestTag("participation-coverage"))
        ui.onNodeWithTag("participation-coverage").assertTextEquals("Eligible 2 of 3 returned quotes")
        ui.onNodeWithTag("screen-content").performScrollToNode(hasTestTag("participation-toggle"))
        ui.onNodeWithTag("participation-toggle").performClick()
        ui.onNodeWithTag("screen-content").performScrollToNode(hasTestTag("mover-STOCK-1"))
        ui.onNodeWithTag("mover-STOCK-1").assertTextEquals("STOCK-A: +10.00%")
        ui.runOnIdle { state.value = state.value.copy(selected = MarketIndex.SENSEX) }
        ui.onNodeWithTag("mover-STOCK-1").assertTextEquals("STOCK-A: +10.00%")
        ui.onNodeWithTag("screen-content").performScrollToNode(hasTestTag("mover-SECTOR-2"))
        ui.onNodeWithTag("mover-SECTOR-2").assertTextEquals("SECTOR-A: +10.00%")
        ui.runOnIdle { state.value = state.value.copy(currentElapsedMs = 5001) }
        ui.onNodeWithTag("mover-SECTOR-2").assertDoesNotExist()
        ui.onNodeWithTag("screen-content").performScrollToNode(hasTestTag("participation-coverage"))
        ui.onNodeWithTag("participation-coverage").assertTextEquals("Eligible 0 of 3 returned quotes")
    }
}

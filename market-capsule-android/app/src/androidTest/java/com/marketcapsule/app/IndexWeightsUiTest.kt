package com.marketcapsule.app

import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

class IndexWeightsUiTest {
    @get:Rule val ui = createComposeRule()

    @Test fun eachIndexShowsItsOwnDatedWeightsAndCoverage() {
        var marketSelections = 0
        ui.setContent { MaterialTheme { CapsuleScreen(MarketUiState(), { marketSelections++ }, {}) } }
        val screen = ui.onNodeWithTag("screen-content")
        screen.performScrollToNode(hasTestTag("index-weight-coverage"))
        ui.onNodeWithTag("index-weight-coverage").assertTextEquals("Top 10 of 50 · 53.04% combined weight")
        ui.onNodeWithTag("index-weight-date").assertTextEquals("NSE Indices factsheet · 2026-10-30")
        screen.performScrollToNode(hasTestTag("index-weight-toggle"))
        ui.onNodeWithTag("index-weight-toggle").performClick()
        screen.performScrollToNode(hasTestTag("weight-HDFCBANK"))
        ui.onNodeWithTag("weight-HDFCBANK").assertTextEquals("HDFC Bank · 9.95%")
        screen.performScrollToNode(hasTestTag("index-weights-BANK_NIFTY"))
        ui.onNodeWithTag("index-weights-BANK_NIFTY").performClick()
        ui.onNodeWithTag("index-weights-BANK_NIFTY").assertIsSelected()
        screen.performScrollToNode(hasTestTag("index-weight-coverage"))
        ui.onNodeWithTag("index-weight-coverage").assertTextEquals("Top 10 of 14 · 87.86% combined weight")
        screen.performScrollToNode(hasTestTag("weight-HDFCBANK"))
        ui.onNodeWithTag("weight-HDFCBANK").assertTextEquals("HDFC Bank · 18.18%")
        ui.onNodeWithTag("weight-RELIANCE").assertDoesNotExist()
        ui.runOnIdle { assertEquals(0, marketSelections) }
    }
}

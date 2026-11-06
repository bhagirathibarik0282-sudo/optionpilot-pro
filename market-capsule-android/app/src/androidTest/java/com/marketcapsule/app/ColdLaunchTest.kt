package com.marketcapsule.app

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import org.junit.Rule
import org.junit.Test

class ColdLaunchTest {
    @get:Rule val ui = createAndroidComposeRule<MainActivity>()
    @Test fun actualActivityOpensOfflineAndSurvivesRecreation() {
        ui.onNodeWithText("Market Capsule").assertIsDisplayed()
        ui.onNodeWithText("NO ELIGIBLE READING").assertIsDisplayed()
        ui.onNodeWithTag("tab-MEMORY").performClick()
        ui.activityRule.scenario.recreate()
        ui.onNodeWithText("NIFTY · No saved reading").assertIsDisplayed()
        ui.onNodeWithTag("tab-TODAY").performClick()
        ui.onNodeWithTag("refresh").performScrollTo().performClick()
        ui.waitUntil(20_000) {
            ui.onAllNodesWithText("Requesting…").fetchSemanticsNodes().isEmpty()
        }
        ui.onNodeWithText("NO ELIGIBLE READING").assertIsDisplayed()
        ui.onNodeWithTag("refresh").assertIsEnabled()
    }
}

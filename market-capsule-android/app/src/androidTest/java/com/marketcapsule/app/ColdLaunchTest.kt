package com.marketcapsule.app

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import org.junit.Rule
import org.junit.Test
import androidx.test.platform.app.InstrumentationRegistry
import android.os.ParcelFileDescriptor.AutoCloseInputStream

class ColdLaunchTest {
    @get:Rule val ui = createAndroidComposeRule<MainActivity>()
    private fun shell(command: String): String {
        return AutoCloseInputStream(InstrumentationRegistry.getInstrumentation().uiAutomation
            .executeShellCommand(command)).bufferedReader().use { it.readText() }
    }
    @Test fun actualActivityOpensOfflineAndSurvivesRecreation() {
        shell("cmd connectivity airplane-mode enable")
        shell("svc wifi disable"); shell("svc data disable")
        ui.waitUntil(15_000) { Regex("Active default network:\\s*(?:none|null)",RegexOption.IGNORE_CASE)
            .containsMatchIn(shell("dumpsys connectivity")) }

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
        ui.onNodeWithTag("screen-content").performScrollToNode(hasText(
            "Connection interrupted or unavailable. Saved readings remain historical."))
        ui.onNodeWithText("Connection interrupted or unavailable. Saved readings remain historical.").assertIsDisplayed()
    }
}

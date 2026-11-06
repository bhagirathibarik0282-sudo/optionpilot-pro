package com.marketcapsule.app

import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.*
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.junit4.createComposeRule
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

/** Synthetic UI states only: these prices are never bundled in the production app. */
class CapsuleUiTest {
    @get:Rule val ui = createComposeRule()
    private fun snapshot() = MarketSnapshot("fixture", 1, "2026-11-05T04:00:00Z", true, "CONNECTED",
        mapOf(MarketIndex.NIFTY to Quote(MarketIndex.NIFTY, 24001.25, 0.5,
            "2026-11-05T04:00:00Z", "2026-11-05T04:00:00Z", 0, "LIVE",
            null, null, null, null, null, null)))

    @Test fun kiteLoginIsExplicitUserActionOnTodayAndDesk() {
        var invocations = 0
        ui.setContent { MaterialTheme { CapsuleScreen(MarketUiState(), {}, {}, {}, { _, _ -> },
            onKiteLogin = { invocations++ }) } }
        ui.onNodeWithTag("screen-content").performScrollToNode(hasTestTag("kite-connect"))
        ui.onNodeWithTag("kite-connect").performClick()
        ui.onNodeWithTag("tab-DESK").performClick()
        ui.onNodeWithTag("screen-content").performScrollToNode(hasTestTag("kite-connect"))
        ui.onNodeWithTag("kite-connect").performClick()
        ui.runOnIdle { assertEquals(2, invocations) }
    }
    @Test fun emptyScreenAndAllTabsRemainUsable() {
        ui.setContent { MaterialTheme { CapsuleScreen(MarketUiState(), {}, {}) } }
        ui.onNodeWithText("NO ELIGIBLE READING").assertIsDisplayed()
        ui.onNodeWithTag("tab-DESK").performClick()
        ui.onNodeWithTag("screen-content").performScrollToNode(hasText("Exact selected option pair"))
        ui.onNodeWithText("Exact selected option pair").assertIsDisplayed()
        ui.onNodeWithTag("tab-MEMORY").performClick()
        ui.onNodeWithText("NIFTY · No saved reading").assertIsDisplayed()
        ui.onNodeWithTag("tab-PROJECT").performClick()
        ui.onNodeWithText("Highest priority: usable app first").assertIsDisplayed()
        ui.onNodeWithTag("tab-TODAY").performClick()
        ui.onNodeWithText("NO ELIGIBLE READING").assertIsDisplayed()
    }
    @Test fun tabSwitchPreservesIndependentScrollPositions() {
        ui.setContent { MaterialTheme { CapsuleScreen(MarketUiState(), {}, {}) } }
        ui.onNodeWithTag("screen-content").performScrollToNode(hasText("Source coverage"))
        ui.onNodeWithText("Source coverage").assertIsDisplayed()
        ui.onNodeWithTag("tab-DESK").performClick()
        ui.onNodeWithText("Market Capsule").assertIsDisplayed()
        ui.onNodeWithTag("screen-content").performScrollToNode(hasText("Multi-expiry ATM ladder"))
        ui.onNodeWithText("Multi-expiry ATM ladder").assertIsDisplayed()
        val deskOffset = ui.onNodeWithTag("screen-content").fetchSemanticsNode()
            .config[SemanticsProperties.VerticalScrollAxisRange].value()
        ui.onNodeWithTag("tab-MEMORY").performClick()
        ui.onNodeWithText("Market Capsule").assertIsDisplayed()
        ui.onNodeWithTag("tab-TODAY").performClick()
        ui.onNodeWithText("Source coverage").assertIsDisplayed()
        ui.onNodeWithTag("tab-DESK").performClick()
        val restoredOffset = ui.onNodeWithTag("screen-content").fetchSemanticsNode()
            .config[SemanticsProperties.VerticalScrollAxisRange].value()
        assertEquals("Live Desk scroll offset changed after returning", deskOffset, restoredOffset, 0.000001f)
        ui.onNodeWithText("Multi-expiry ATM ladder").assertIsDisplayed()
    }
    @Test fun pcrTypesRemainSeparateAndWithdrawOnExpiry() {
        val time = "2026-11-05T04:00:00Z"
        val pcr = PcrReading(MarketIndex.NIFTY, "2026-11-09", time, 0, 200, 200,
            PcrValue(1.5, 100.0, 150.0, time, time), null,
            PcrValue(1.5, 100.0, 150.0, time, time, olderAtCheck = 0), "Unavailable")
        val state = mutableStateOf(MarketUiState(current = snapshot().copy(
            pcrReadings = mapOf(MarketIndex.NIFTY to pcr)), receivedElapsedMs = 0))
        ui.setContent { MaterialTheme { CapsuleScreen(state.value, {}, {}) } }
        ui.onNodeWithTag("tab-DESK").performClick()
        ui.onNodeWithTag("screen-content").performScrollToNode(hasTestTag("full-pcr"))
        ui.onNodeWithTag("full-pcr").assertTextEquals("Full PCR · verified snapshot: 1.5000")
        ui.onNodeWithTag("screen-content").performScrollToNode(hasTestTag("reported-pcr"))
        ui.onNodeWithTag("reported-pcr").assertTextEquals("Full PCR · latest reported: 1.5000")
        ui.runOnIdle {
            val mixed = pcr.copy(full = null, freshOi = 198,
                reported = PcrValue(1.8, 100.0, 180.0, time, time, olderAtCheck = 2))
            state.value = state.value.copy(current = state.value.current!!.copy(
                pcrReadings = mapOf(MarketIndex.NIFTY to mixed)))
        }
        ui.onNodeWithTag("reported-pcr").assertTextEquals("Full PCR · latest reported: 1.8000")
        ui.onNodeWithTag("screen-content").performScrollToNode(hasTestTag("full-pcr"))
        ui.onNodeWithTag("full-pcr").assertTextEquals("Full PCR · verified snapshot: —")
        ui.onNodeWithTag("screen-content").performScrollToNode(hasTestTag("reported-pcr"))
        ui.runOnIdle { state.value = state.value.copy(currentElapsedMs = 90_001) }
        ui.onNodeWithTag("reported-pcr").assertTextEquals("Full PCR · latest reported: —")
        ui.onNodeWithTag("screen-content").performScrollToNode(hasTestTag("full-pcr"))
        ui.onNodeWithTag("full-pcr").assertTextEquals("Full PCR · verified snapshot: —")
    }
    @Test fun pcrCannotFollowTheWrongIndexOrSavedCache() {
        val time = "2026-11-05T04:00:00Z"
        val pcr = PcrReading(MarketIndex.NIFTY, "2026-11-09", time, 0, 2, 2,
            PcrValue(1.5, 100.0, 150.0, time, time), null, null, "Unavailable")
        val current = snapshot().copy(pcrReadings = mapOf(MarketIndex.NIFTY to pcr))
        val state = mutableStateOf(MarketUiState(current = current, receivedElapsedMs = 0))
        ui.setContent { MaterialTheme { CapsuleScreen(state.value, { state.value = state.value.copy(selected = it) }, {}) } }
        ui.onNodeWithTag("index-SENSEX").performClick()
        ui.onNodeWithTag("tab-DESK").performClick()
        ui.onNodeWithTag("screen-content").performScrollToNode(hasTestTag("full-pcr"))
        ui.onNodeWithTag("full-pcr").assertTextEquals("Full PCR · verified snapshot: —")
        ui.runOnIdle { state.value = state.value.copy(selected = MarketIndex.NIFTY, current = null, saved = current) }
        ui.onNodeWithTag("full-pcr").assertTextEquals("Full PCR · verified snapshot: —")
    }
    @Test fun indexSwitchNeverReusesOtherIndexPrice() {
        val state = mutableStateOf(MarketUiState(current = snapshot(), receivedElapsedMs = 0))
        ui.setContent { MaterialTheme { CapsuleScreen(state.value, { state.value = state.value.copy(selected = it) }, {}) } }
        ui.onNodeWithText("RECENT SNAPSHOT — NOT A CONTINUOUS STREAM").assertIsDisplayed()
        ui.onNodeWithTag("index-SENSEX").performClick()
        ui.onNodeWithText("NO ELIGIBLE READING").assertIsDisplayed()
        ui.onNodeWithText("₹24,001.25").assertDoesNotExist()
    }
    @Test fun savedReadingIsHistorical() {
        ui.setContent { MaterialTheme { CapsuleScreen(MarketUiState(saved = snapshot()), {}, {}) } }
        ui.onNodeWithText("SAVED READING AVAILABLE IN MEMORY").assertIsDisplayed()
        ui.onNodeWithTag("tab-MEMORY").performClick()
        ui.onNodeWithText("NIFTY · SAVED — NOT LIVE").assertIsDisplayed()
        ui.onNodeWithText("₹24,001.25").assertIsDisplayed()
        ui.onNodeWithText("RECENT SNAPSHOT — NOT A CONTINUOUS STREAM").assertDoesNotExist()
    }
    @Test fun expiryAndRecoveryChangeVisibleEligibility() {
        val state = mutableStateOf(MarketUiState(current = snapshot(), receivedElapsedMs = 0))
        ui.setContent { MaterialTheme { CapsuleScreen(state.value, {}, {}) } }
        ui.onNodeWithText("₹24,001.25").assertIsDisplayed()
        ui.runOnIdle { state.value = state.value.copy(currentElapsedMs = 6000) }
        ui.onNodeWithText("STALE / REFRESH REQUIRED").assertIsDisplayed()
        ui.onNodeWithText("₹24,001.25").assertDoesNotExist()
        ui.runOnIdle { state.value = state.value.copy(receivedElapsedMs = 6000) }
        ui.onNodeWithText("₹24,001.25").assertIsDisplayed()
    }
    @Test fun pendingRequestDisablesRefresh() {
        ui.setContent { MaterialTheme { CapsuleScreen(MarketUiState(loading = true), {}, {}) } }
        ui.onNodeWithTag("refresh").performScrollTo().assertIsNotEnabled()
        ui.onNodeWithText("Requesting…").assertIsDisplayed()
    }
    @Test fun delayedOptionLegIsHiddenEvenWhenSpotIsRecent() {
        val original = snapshot()
        val q = original.quotes.getValue(MarketIndex.NIFTY).copy(
            expiry = "2026-11-09", strike = 24000.0, cePrice = 149.0, ceAgeMs = 29_000)
        val state = MarketUiState(current = original.copy(quotes = mapOf(MarketIndex.NIFTY to q)),
            receivedElapsedMs = 0, deliveryAgeMs = 2000)
        ui.setContent { MaterialTheme { CapsuleScreen(state, {}, {}) } }
        ui.onNodeWithText("RECENT SNAPSHOT — NOT A CONTINUOUS STREAM").assertIsDisplayed()
        ui.onNodeWithTag("tab-DESK").performClick()
        ui.onNodeWithTag("screen-content").performScrollToNode(hasText("CE: ₹—"))
        ui.onNodeWithText("CE: ₹—").assertIsDisplayed()
        ui.onNodeWithText("CE: ₹149.00").assertDoesNotExist()
    }

    @Test fun updatesToggleStopsAndRestoresManualRefresh() {
        val state = mutableStateOf(MarketUiState())
        ui.setContent { MaterialTheme { CapsuleScreen(state.value, {}, {}, {
            state.value = state.value.copy(updatesWanted = it,
                updatePhase = if (it) UpdatePhase.CONNECTING else UpdatePhase.OFF)
        }) } }
        ui.onNodeWithTag("updates-toggle").performScrollTo().performClick()
        ui.onNodeWithText("Stop updates").assertIsDisplayed()
        ui.onNodeWithTag("refresh").assertIsNotEnabled()
        ui.onNodeWithTag("updates-toggle").performClick()
        ui.onNodeWithText("Start updates").assertIsDisplayed()
        ui.onNodeWithTag("refresh").assertIsEnabled()
    }

    @Test fun expiryLadderUsesNativeCardsAndWithdrawsExpiredValues() {
        val snap = snapshot().copy(ladders = mapOf(MarketIndex.NIFTY to listOf(
            ExpiryPair("2026-11-09", 24000.0, PremiumLeg(117.25, 1.0, 0, "2026-11-05T04:00:00Z"), null))))
        val state = mutableStateOf(MarketUiState(current = snap, receivedElapsedMs = 0))
        ui.setContent { MaterialTheme { CapsuleScreen(state.value, {}, {}) } }
        ui.onNodeWithTag("tab-DESK").performClick()
        ui.onNodeWithTag("screen-content").performScrollToNode(hasText("Expiry 2026-11-09"))
        ui.onNodeWithText("₹117.25").assertIsDisplayed()
        ui.onNodeWithText("Unavailable / delayed").performScrollTo().assertIsDisplayed()
        ui.runOnIdle { state.value = state.value.copy(currentElapsedMs = 6000) }
        ui.onNodeWithText("₹117.25").assertDoesNotExist()
    }

    @Test fun switchingIndexDoesNotReuseLadderRows() {
        val snap = snapshot().copy(ladders = mapOf(MarketIndex.NIFTY to listOf(
            ExpiryPair("2026-11-09", 24000.0, PremiumLeg(117.25, null, 0, "2026-11-05T04:00:00Z"), null))))
        val state = mutableStateOf(MarketUiState(current = snap, receivedElapsedMs = 0))
        ui.setContent { MaterialTheme { CapsuleScreen(state.value, { state.value = state.value.copy(selected = it) }, {}) } }
        ui.onNodeWithTag("index-SENSEX").performClick()
        ui.onNodeWithTag("tab-DESK").performClick()
        ui.onNodeWithTag("screen-content").performScrollToNode(hasText("Expiry readings unavailable"))
        ui.onNodeWithText("Expiry readings unavailable").assertIsDisplayed()
        ui.onNodeWithText("₹117.25").assertDoesNotExist()
    }

    @Test fun compactExpirySelectorShowsAllOrOneVerifiedExpiry() {
        val observed = "2026-11-05T04:00:00Z"
        val snap = snapshot().copy(ladders = mapOf(MarketIndex.NIFTY to listOf(
            ExpiryPair("2026-11-09", 24000.0, PremiumLeg(111.0, null, 0, observed), null),
            ExpiryPair("2026-11-16", 24050.0, PremiumLeg(222.0, null, 0, observed), null),
            ExpiryPair("2026-11-23", 24100.0, PremiumLeg(333.0, null, 0, observed), null)
        )))
        ui.setContent { MaterialTheme {
            CapsuleScreen(MarketUiState(current = snap, receivedElapsedMs = 0), {}, {})
        } }
        ui.onNodeWithTag("tab-DESK").performClick()
        ui.onNodeWithTag("screen-content").performScrollToNode(hasTestTag("expiry-filter-2026-11-16"))
        ui.onNodeWithTag("expiry-filter-2026-11-16").performClick()
        ui.onNodeWithTag("screen-content").performScrollToNode(hasText("Expiry 2026-11-16"))
        ui.onNodeWithText("₹222.00").performScrollTo().assertIsDisplayed()
        ui.onNodeWithTag("screen-content").performScrollToNode(hasTestTag("expiry-filter-ALL"))
        ui.onNodeWithTag("expiry-filter-ALL").performClick()
        ui.onNodeWithTag("screen-content").performScrollToNode(hasText("Expiry 2026-11-23"))
        ui.onNodeWithText("₹333.00").performScrollTo().assertIsDisplayed()
    }

    @Test fun strikeBandIsVerticalAndExplicitLoadUsesSelectedIndexAndExpiry() {
        val snap = snapshot().copy(ladders = mapOf(MarketIndex.NIFTY to listOf(
            ExpiryPair("2026-11-09", 24000.0, PremiumLeg(110.0, null, 0, "2026-11-05T04:00:00Z"), null)
        )))
        val requests = mutableListOf<Pair<MarketIndex, String>>()
        ui.setContent { MaterialTheme {
            CapsuleScreen(MarketUiState(current = snap, receivedElapsedMs = 0), {}, {}, {},
                { index, expiry -> requests.add(index to expiry) })
        } }
        ui.onNodeWithTag("tab-DESK").performClick()
        ui.onNodeWithTag("screen-content").performScrollToNode(hasTestTag("strike-window-7"))
        ui.onNodeWithTag("strike-window-7").performClick()
        // The LazyColumn can relayout after choosing ±7: make the load action visible.
        ui.onNodeWithTag("strike-load").performScrollTo().assertIsEnabled().performClick()
        ui.waitForIdle()
        ui.runOnIdle { assertEquals(listOf(MarketIndex.NIFTY to "2026-11-09"), requests) }
    }

}

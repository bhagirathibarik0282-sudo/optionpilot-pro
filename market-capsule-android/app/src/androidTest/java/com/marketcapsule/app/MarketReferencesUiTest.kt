package com.marketcapsule.app

import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import org.junit.Rule
import org.junit.Test

class MarketReferencesUiTest {
    @get:Rule val ui = createComposeRule()
    private fun state(): MarketUiState {
        val time="2026-11-05T04:00:00Z"
        val spot=ReferenceQuote(24000.0,23900.0,23980.0,24100.0,23950.0,time,time,0)
        val future=ReferenceQuote(24050.0,null,null,null,null,time,time,0,"2026-11-26","NIFTYNOVFUT",1002)
        val reference=MarketReference(MarketIndex.NIFTY,spot,future,50.0)
        return MarketUiState(current=MarketSnapshot("fixture",1,time,true,"CONNECTED",emptyMap(),
            references=mapOf(MarketIndex.NIFTY to reference)),receivedElapsedMs=0)
    }
    @Test fun referenceCardLabelsTheExactFutureAndWithdrawsExpiredValues() {
        val s=mutableStateOf(state())
        ui.setContent { MaterialTheme { CapsuleScreen(s.value,{}, {}) } }
        ui.onNodeWithTag("screen-content").performScrollToNode(hasTestTag("reference-pdc"))
        ui.onNodeWithTag("reference-pdc").assertTextEquals("Broker previous close: 23,900.00")
        ui.onNodeWithTag("screen-content").performScrollToNode(hasTestTag("reference-future-contract"))
        ui.onNodeWithTag("reference-future-contract").assertTextEquals("Futures contract: NIFTYNOVFUT · expiry 2026-11-26")
        ui.onNodeWithTag("screen-content").performScrollToNode(hasTestTag("reference-basis"))
        ui.onNodeWithTag("reference-basis").assertTextEquals("Basis (future − spot): 50.00 index points")
        ui.runOnIdle { s.value=s.value.copy(currentElapsedMs=5001) }
        ui.onNodeWithTag("reference-basis").assertTextEquals("Basis (future − spot): — index points")
        ui.onNodeWithTag("screen-content").performScrollToNode(hasTestTag("reference-future"))
        ui.onNodeWithTag("reference-future").assertTextEquals("Futures: —")
        ui.onNodeWithTag("screen-content").performScrollToNode(hasTestTag("reference-pdc"))
        ui.onNodeWithTag("reference-pdc").assertTextEquals("Broker previous close: —")
    }
    @Test fun referencesCannotFollowAnotherIndexOrSavedCache() {
        val s=mutableStateOf(state())
        ui.setContent { MaterialTheme { CapsuleScreen(s.value,{}, {}) } }
        ui.onNodeWithTag("screen-content").performScrollToNode(hasTestTag("reference-pdc"))
        ui.runOnIdle { s.value=s.value.copy(selected=MarketIndex.SENSEX) }
        ui.onNodeWithTag("reference-pdc").assertTextEquals("Broker previous close: —")
        ui.runOnIdle { s.value=s.value.copy(selected=MarketIndex.NIFTY,current=null,saved=s.value.current) }
        ui.onNodeWithTag("reference-pdc").assertTextEquals("Broker previous close: —")
        ui.onNodeWithTag("screen-content").performScrollToNode(hasTestTag("reference-future"))
        ui.onNodeWithTag("reference-future").assertTextEquals("Futures: —")
    }
}

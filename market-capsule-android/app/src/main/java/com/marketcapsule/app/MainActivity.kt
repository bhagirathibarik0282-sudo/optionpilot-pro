package com.marketcapsule.app

import android.os.Bundle
import android.content.Intent
import android.net.Uri
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.ShowChart
import androidx.compose.material.icons.outlined.History
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.compose.LifecycleStartEffect
import androidx.lifecycle.viewmodel.compose.viewModel
import java.text.NumberFormat
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

private val Gold = Color(0xFFF5CE79)
private val Navy = Color(0xFF071321)
private val Panel = Color(0xFF101F32)
private val Muted = Color(0xFFB8C7DA)
private val Up = Color(0xFF66E4B3)
private val Down = Color(0xFFFF929E)
private val Palette = darkColorScheme(primary = Gold, onPrimary = Navy, background = Navy,
    onBackground = Color(0xFFECF3FF), surface = Panel, onSurface = Color(0xFFECF3FF),
    secondary = Color(0xFF8CC9FF))
private enum class Page(val label: String) { TODAY("Today"), DESK("Live Desk"), MEMORY("Memory"), PROJECT("Project") }

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { MaterialTheme(colorScheme = Palette) { CapsuleApp() } }
    }
}
@Composable private fun CapsuleApp(vm: MarketViewModel = viewModel()) {
    val state by vm.state.collectAsStateWithLifecycle()
    LifecycleStartEffect(vm) {
        vm.setForeground(true)
        onStopOrDispose { vm.setForeground(false) }
    }
    val context = androidx.compose.ui.platform.LocalContext.current
    CapsuleScreen(state, vm::select, vm::refresh, vm::setUpdatesWanted, vm::loadStrikes, vm::refreshFiiDii) {
        // User-initiated external browser only. The broker request token and API secret
        // must be exchanged and stored by the already-existing server callback.
        val route = Uri.parse(BASE_URL + "/api/kite/login")
        runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, route)) }
            .onFailure {
                Toast.makeText(context, "No browser available for Kite login", Toast.LENGTH_LONG).show()
            }
    }
}
@Composable internal fun CapsuleScreen(state: MarketUiState, onSelect: (MarketIndex) -> Unit, onRefresh: () -> Unit, onUpdatesWanted: (Boolean) -> Unit = {}, onLoadStrikes: (MarketIndex, String) -> Unit = { _, _ -> }, onRefreshFiiDii: () -> Unit = {}, onKiteLogin: () -> Unit = {}) {
    var page by rememberSaveable { mutableStateOf(Page.TODAY) }
    // Each destination owns its position; a long ladder must not scroll another tab.
    val todayScroll = rememberLazyListState()
    val deskScroll = rememberLazyListState()
    val memoryScroll = rememberLazyListState()
    val projectScroll = rememberLazyListState()
    val displayedPage = page
    val pageScroll = when (displayedPage) {
        Page.TODAY -> todayScroll
        Page.DESK -> deskScroll
        Page.MEMORY -> memoryScroll
        Page.PROJECT -> projectScroll
    }
    // Persist selection through frame updates but reset on an index change.
    var expiryChoice by rememberSaveable(state.selected.name) { mutableStateOf("ALL") }
    var strikeBand by rememberSaveable { mutableIntStateOf(3) }
    Scaffold(containerColor = Navy, bottomBar = {
        NavigationBar(containerColor = Panel) {
            Page.entries.forEach { item -> NavigationBarItem(modifier = Modifier.testTag("tab-${item.name}"), selected = page == item,
                onClick = { page = item }, label = { Text(item.label) }, icon = {
                    Icon(when(item) { Page.TODAY -> Icons.Outlined.Home; Page.DESK -> Icons.Outlined.ShowChart
                        Page.MEMORY -> Icons.Outlined.History; Page.PROJECT -> Icons.Outlined.Info }, contentDescription = item.label)
                }) }
        }
    }) { padding ->
        // A separate composition also isolates LazyColumn key/anchor bookkeeping.
        key(displayedPage) {
        LazyColumn(state = pageScroll, modifier = Modifier.testTag("screen-content").fillMaxSize().padding(padding), contentPadding = PaddingValues(18.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp)) {
            item {
                Text("Market Capsule", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.SemiBold)
                Text("ନିଜ marketକୁ ପ୍ରମାଣ ସହ ବୁଝନ୍ତୁ", color = Muted)
                Spacer(Modifier.height(12.dp))
                Text("TEST 0.1.10 · READ ONLY · NO TRADING", color = Gold, style = MaterialTheme.typography.labelMedium)
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    MarketIndex.entries.forEach { symbol -> FilterChip(selected = state.selected == symbol,
                        modifier = Modifier.testTag("index-${symbol.name}"), onClick = { onSelect(symbol) }, label = { Text(symbol.name) }) }
                }
            }
            if (displayedPage == Page.TODAY || displayedPage == Page.DESK) {
                item { QuoteCard(state) }
                item {
                    Button(onClick = onRefresh, enabled = !state.loading && !state.updatesWanted, modifier = Modifier.testTag("refresh").fillMaxWidth()) {
                        Text(if(state.loading) "Requesting…" else "Refresh snapshot")
                    }
                    OutlinedButton(onClick = { onUpdatesWanted(!state.updatesWanted) },
                        modifier = Modifier.testTag("updates-toggle").fillMaxWidth()) {
                        Text(if (state.updatesWanted) "Stop updates" else "Start updates")
                    }
                    Text(state.updatePhase.label, color = Gold, style = MaterialTheme.typography.labelMedium)
                    Text(state.message, color = Muted, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = 8.dp))
                    OutlinedButton(onClick = onKiteLogin, modifier = Modifier.fillMaxWidth().testTag("kite-connect")) {
                        Text("Connect Kite · secure browser login")
                    }
                    Text("Zerodha login opens in your browser. Return to this app and refresh after login. The Kite access token is handled by the backend; it is never stored in the APK.",
                        color = Muted, style = MaterialTheme.typography.labelSmall)
                }
            }
            when(displayedPage) {
                Page.TODAY -> {
                    val capsule = TodayCapsuleComposer.compose(state)
                    item { Section("What changed · verified observation") {
                        Text(if (capsule.hasObservation) "Today capsule · partial evidence" else "Today capsule · waiting for data",
                            color = Gold, modifier = Modifier.testTag("today-capsule-status"))
                        Text(capsule.dayChangePct?.let {
                            "${capsule.index.name}: ${signed(it)}% versus broker previous close."
                        } ?: "Day change unavailable. Refresh for a new observation.",
                            modifier = Modifier.testTag("today-day-change"))
                        Text("ଏହା previous close ସହ ତୁଳନା; last update ପରଠାରୁ movement ବା buyingର କାରଣ ନୁହେଁ।",
                            color = Muted, style = MaterialTheme.typography.bodySmall)
                        val pcr = capsule.pcr
                        if (pcr?.full != null) Text("Full PCR · verified: ${ratioText(pcr.full.ratio)} · ${pcr.expiry}",
                            modifier = Modifier.testTag("today-full-pcr"))
                        else Text("Full PCR · verified: —", modifier = Modifier.testTag("today-full-pcr"))
                        if (pcr?.band != null) Text("ATM ±7 band PCR: ${ratioText(pcr.band.ratio)} · ${pcr.expiry}",
                            modifier = Modifier.testTag("today-band-pcr"))
                        if (pcr?.reported != null) Text("Latest reported PCR: ${ratioText(pcr.reported.ratio)} · ${pcr.expiry} · mixed source times",
                            color = Muted, modifier = Modifier.testTag("today-reported-pcr"))
                    } }
                    item { MarketReferenceCard(state) }
                    item { MarketContextCard(state) }
                    item { ParticipationCard(state) }
                    item { IndexWeightsCard() }
                    item { FiiDiiCard(state, onRefreshFiiDii) }
                    item { Section("Why / Watch next") {
                        Text("Market cause unverified. News and historical matching are not connected.",
                            color = Muted, modifier = Modifier.testTag("today-cause"))
                        capsule.watchNext.forEachIndexed { n, condition -> Text("${n + 1}. $condition") }
                        Text("Observation only · no trade suggestion or prediction.", color = Gold,
                            style = MaterialTheme.typography.labelSmall)
                    } }
                    item { Section("Source coverage") {
                        Text("Spot and PCR are checked independently. Missing data does not become zero.", color = Muted)
                        var showEvidence by rememberSaveable(state.selected.name) { mutableStateOf(false) }
                        TextButton(onClick = { showEvidence = !showEvidence }, modifier = Modifier.testTag("today-evidence-toggle")) {
                            Text(if (showEvidence) "Hide evidence" else "Show evidence")
                        }
                        if (showEvidence) {
                            Text("${capsule.index.name} · Kite via existing OptionPilot backend")
                            Text("Spot source time: ${at(capsule.spotObservedAt)}")
                            val pcr = capsule.pcr
                            Text("PCR expiry: ${pcr?.expiry ?: "Unavailable"} · checked: ${at(pcr?.checkedAt)}")
                            listOf("Verified full" to pcr?.full, "ATM ±7 band" to pcr?.band,
                                "Latest reported" to pcr?.reported).forEach { (label, value) ->
                                if (value != null) Text("$label OI source: ${at(value.sourceMinAt)} → ${at(value.sourceMaxAt)}")
                            }
                            Text("Full refers to subscribed expiry inventory. Band and reported PCR never replace verified full PCR.", color = Muted)
                            Text("Day change is not change since the last refresh. Index weights and dated FII/DII have separate cards. News context remains unavailable here.", color = Muted)
                        }
                    } }
                }
                Page.DESK -> {
                item(key = "pcr-${state.selected}") { PcrCard(state) }
                item { Section("Exact selected option pair") {
                    val quote = state.quote
                    val elapsed = state.receivedElapsedMs?.let { (state.currentElapsedMs - it).coerceAtLeast(0) }
                    val ceEligible = state.status == ReadingStatus.RECENT_SNAPSHOT && elapsed != null &&
                        quote?.ceAgeMs?.let { it + elapsed + state.deliveryAgeMs <= QUOTE_MAX_AGE_MS } == true
                    val peEligible = state.status == ReadingStatus.RECENT_SNAPSHOT && elapsed != null &&
                        quote?.peAgeMs?.let { it + elapsed + state.deliveryAgeMs <= QUOTE_MAX_AGE_MS } == true
                    Text("Expiry: ${quote?.expiry ?: "Unavailable"} · Strike: ${format(quote?.strike)}")
                    Text("CE: ₹${format(if(ceEligible) quote?.cePrice else null)}")
                    Text("PE: ₹${format(if(peEligible) quote?.pePrice else null)}")
                    Text("Each leg is checked separately. Multi-expiry ATM cards follow below.", color = Muted)
                } }
                item { Text("Multi-expiry ATM ladder", color = Gold, style = MaterialTheme.typography.titleLarge,
                    modifier = Modifier.testTag("expiry-ladder-title")) }
                val pairs = state.current?.ladders?.get(state.selected).orEmpty()
                // A vanished expiry cannot remain a sticky, invisible selection.
                val availableChoice = if (expiryChoice == "ALL" || pairs.any { it.expiry == expiryChoice }) expiryChoice else "ALL"
                if (pairs.isEmpty()) item { Section("Expiry readings unavailable") {
                    Text("Refresh or start updates. This panel needs verified expiry identities from the server.", color = Muted)
                } } else item(key = "expiry-filter-${state.selected}") {
                    Column(verticalArrangement = Arrangement.spacedBy(5.dp)) {
                        Text("View expiries · no horizontal swipe", color = Muted, style = MaterialTheme.typography.labelMedium)
                        (listOf("ALL") + pairs.map { it.expiry }).chunked(2).forEach { choices ->
                            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                choices.forEach { choice ->
                                    FilterChip(
                                        selected = availableChoice == choice,
                                        onClick = { expiryChoice = choice },
                                        modifier = Modifier.weight(1f).testTag("expiry-filter-$choice"),
                                        label = { Text(if (choice == "ALL") "All (${pairs.size})" else shortExpiry(choice), maxLines = 1) }
                                    )
                                }
                                if (choices.size == 1) Spacer(Modifier.weight(1f))
                            }
                        }
                    }
                }
                visibleExpiryPairs(pairs, availableChoice).forEach { pair -> item(key = "${state.selected}-${pair.expiry}") {
                    Section("Expiry ${pair.expiry}") {
                        Text("${state.selected.name} · Strike ${format(pair.strike)}", color = Muted)
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            PremiumCell("CE", pair.ce, state, Modifier.weight(1f))
                            PremiumCell("PE", pair.pe, state, Modifier.weight(1f))
                        }
                    }
                } }
                if (pairs.isNotEmpty()) item(key = "strike-ladder-panel-${state.selected}") {
                    Section("CE | Strike | PE · on-demand ladder") {
                        val target = if (availableChoice == "ALL") pairs.first().expiry else availableChoice
                        val reference = pairs.firstOrNull { it.expiry == target }?.strike
                        Text("Selected expiry: $target" + if (availableChoice == "ALL") " (nearest from All)" else "",
                            color = Muted, style = MaterialTheme.typography.bodySmall)
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                            listOf(3, 5, 7).forEach { band ->
                                FilterChip(selected = strikeBand == band, onClick = { strikeBand = band },
                                    label = { Text("±$band") }, modifier = Modifier.weight(1f).testTag("strike-window-$band"))
                            }
                        }
                        Button(onClick = { onLoadStrikes(state.selected, target) }, modifier = Modifier.fillMaxWidth().testTag("strike-load"),
                            enabled = !state.strikeLoading && state.status == ReadingStatus.RECENT_SNAPSHOT && reference != null) {
                            Text(if (state.strikeLoading) "Loading strikes…" else "Load strikes · read only")
                        }
                        val read = state.strikeLadder?.takeIf { it.index == state.selected && it.expiry == target &&
                            it.runtimeId == state.current?.runtimeId }
                        if (read != null) {
                            val visible = visibleStrikeRows(read.rows, reference, strikeBand)
                            if (visible.isEmpty()) {
                                Text("ATM reference is unavailable in the returned exact strikes; no substitute.", color = Muted)
                            } else {
                                Row(Modifier.fillMaxWidth().padding(horizontal = 3.dp),
                                    horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                                    Text("CE premium", modifier = Modifier.weight(1f), color = Muted,
                                        style = MaterialTheme.typography.labelSmall)
                                    Text("STRIKE", modifier = Modifier.weight(1.04f), textAlign = TextAlign.Center,
                                        color = Muted, style = MaterialTheme.typography.labelSmall)
                                    Text("PE premium", modifier = Modifier.weight(1f), textAlign = TextAlign.End,
                                        color = Muted, style = MaterialTheme.typography.labelSmall)
                                }
                                visible.forEach { row ->
                                    val atm = row.strike == reference
                                    Row(Modifier.fillMaxWidth().background(if (atm) Navy else Panel, RoundedCornerShape(6.dp))
                                        .padding(vertical = 5.dp, horizontal = 3.dp),
                                        horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                                        Text("₹${format(if(read.isCurrent(state, row.ce)) row.ce?.price else null)}",
                                            modifier = Modifier.weight(1f), textAlign = TextAlign.Start,
                                            style = MaterialTheme.typography.bodySmall, color = Up)
                                        Text(strikeText(row.strike) + if (atm) " ATM" else "",
                                            modifier = Modifier.weight(1.04f), textAlign = TextAlign.Center,
                                            style = MaterialTheme.typography.bodySmall, color = Gold)
                                        Text("₹${format(if(read.isCurrent(state, row.pe)) row.pe?.price else null)}",
                                            modifier = Modifier.weight(1f), textAlign = TextAlign.End,
                                            style = MaterialTheme.typography.bodySmall, color = Down)
                                    }
                                }
                                Text("Only the existing source's exact strikes are shown. — means delayed/missing. Prices expire; tap Load again to refresh.",
                                    color = Muted, style = MaterialTheme.typography.labelSmall)
                            }
                        } else Text("No loaded ladder for this index and expiry.", color = Muted,
                            style = MaterialTheme.typography.bodySmall)
                        Text(state.strikeMessage, color = Muted, style = MaterialTheme.typography.labelSmall)
                    }
                }
                item { Text("ATM can change between snapshots. Compare the same strike and expiry when tracking a move. % is versus broker previous close.",
                    color = Muted, style = MaterialTheme.typography.bodySmall) }
                }
                Page.MEMORY -> item { Section("Last saved server observation") {
                    val quote = state.savedQuote
                    Text("${state.selected.name} · ${if(quote?.price != null) "SAVED — NOT LIVE" else "No saved reading"}", color = Gold)
                    Text("₹${format(quote?.price)}", style = MaterialTheme.typography.headlineMedium)
                    Text("Source: ${at(quote?.observedAt)}")
                    Text("Saved server snapshot: ${at(state.saved?.serverTime)}")
                    Text("This is the last valid local snapshot. Recorded-session replay and comparable-event RAG are not implemented here yet.", color = Muted)
                } }
                Page.PROJECT -> {
                    item { Section("Highest priority: usable app first") {
                        Text("1. Independent UI and honest snapshot states\n2. Verify read access and reconnecting SSE\n3. Capsule evidence, premium ladder and same-app replay\n4. AI questions and notifications\n5. Manual Buy/Sell only in a later verified phase")
                    } }
                    item { Section("REA's role") {
                        Text("Optional investigation and verification of browser behavior, scripts and captures.")
                        Text("REA is not the app runtime, broker data source, calculation engine or AI memory. Development does not depend on an REA connection.", color = Muted)
                    } }
                    item { Section("Build acceptance") {
                        Text("Debug APK compilation, unit tests and lint passed for 0.1. Physical-device testing, mobile sign-in and Play publishing remain pending. Emulator evidence is tracked in the project ledger.", color = Gold)
                    } }
                }
            }
        }
        }
    }
}
@Composable private fun FiiDiiCard(state: MarketUiState, onRefresh: () -> Unit) {
    Section("FII/DII cash flow · EOD") {
        Text("NSE cash market · ₹ crore", color = Muted)
        val reading = state.fiiDii
        if (reading != null) {
            val row = reading.latest
            Text("Trading date: ${row.date}", modifier = Modifier.testTag("fii-dii-date"))
            Text("FII/FPI net: ${signed(row.fiiNetCrore)}", modifier = Modifier.testTag("fii-net"))
            Text("DII net: ${signed(row.diiNetCrore)}", modifier = Modifier.testTag("dii-net"))
            Text("Combined net: ${signed(row.combinedNetCrore)}")
            Text("Fetched: ${at(row.fetchedAt.toString())}", color = Muted)
            Text("Expected session at server check: ${reading.expectedSession}", color = Muted)
            Text("Publication time and revision status unavailable.", color = Muted,
                style = MaterialTheme.typography.bodySmall)
        }
        Text(state.fiiDiiMessage, color = Muted, modifier = Modifier.testTag("fii-dii-status"))
        TextButton(onClick = onRefresh, enabled = !state.fiiDiiLoading,
            modifier = Modifier.testTag("fii-dii-refresh")) {
            Text(if (state.fiiDiiLoading) "Checking FII/DII…" else "Refresh FII/DII")
        }
    }
}

@Composable private fun IndexWeightsCard() {
    var selected by rememberSaveable { mutableStateOf(IndexWeightSnapshot.NIFTY_50) }
    var expanded by rememberSaveable { mutableStateOf(false) }
    val context = androidx.compose.ui.platform.LocalContext.current
    Section("Index constituent weights") {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            IndexWeightSnapshot.entries.forEach { index ->
                FilterChip(selected = selected == index, onClick = { selected = index },
                    label = { Text(index.label) }, modifier = Modifier.testTag("index-weights-${index.name}"))
            }
        }
        Text("NSE Indices factsheet · ${selected.asOf}", color = Muted,
            modifier = Modifier.testTag("index-weight-date"))
        Text("Top ${selected.rows.size} of ${selected.constituentCount} · ${format(selected.coveredPercent)}% combined weight",
            modifier = Modifier.testTag("index-weight-coverage"))
        TextButton(onClick = { expanded = !expanded }, modifier = Modifier.testTag("index-weight-toggle")) {
            Text(if (expanded) "Hide weights" else "Show weights")
        }
        if (expanded) {
            selected.rows.forEach { constituent ->
                Text("${constituent.name} · ${format(constituent.hundredths / 100.0)}%",
                    modifier = Modifier.testTag("weight-${constituent.symbol}"))
            }
            TextButton(onClick = {
                runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(selected.sourceUrl))) }
                    .onFailure { Toast.makeText(context, "No browser available for factsheet", Toast.LENGTH_LONG).show() }
            }) { Text("Open NSE Indices factsheet") }
        }
    }
}

@Composable private fun ParticipationCard(state: MarketUiState) {
    val participation = state.current?.participation
    val eligible = participation?.eligible(state).orEmpty()
    Section("Tracked market participation") {
        Text("Shared market context · tracked subset", color = Muted)
        Text("Eligible ${eligible.size} of ${participation?.returnedCount ?: 0} returned quotes",
            modifier = Modifier.testTag("participation-coverage"))
        Text("% versus broker previous close", color = Muted, style = MaterialTheme.typography.bodySmall)
        var expanded by rememberSaveable { mutableStateOf(false) }
        if (eligible.isEmpty()) {
            Text("Participation readings unavailable. Refresh for a new observation.", color = Muted)
        } else {
            TextButton(onClick = { expanded = !expanded }, modifier = Modifier.testTag("participation-toggle")) {
                Text(if (expanded) "Hide tracked movers" else "Show tracked movers")
            }
            if (expanded) ParticipationKind.entries.forEach { kind ->
                Text(kind.title, color = Gold)
                listOf(true, false).forEach { rising ->
                    val movers = participation?.movers(state, kind, rising).orEmpty()
                    Text(if (rising) "Gainers" else "Decliners", color = Muted)
                    if (movers.isEmpty()) Text("No eligible readings in this group", color = Muted)
                    movers.forEach { reading ->
                        Text("${reading.label}: ${signed(reading.changePct)}%",
                            color = if (rising) Up else Down,
                            modifier = Modifier.testTag("mover-${kind.name}-${reading.token}"))
                        Text("Source: ${at(reading.quote.observedAt)}", color = Muted,
                            style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
        }
    }
}

@Composable private fun MarketContextCard(state: MarketUiState) {
    val context = state.current?.marketContext
    val vix = context?.indiaVix?.takeIf { it.isFresh(state) }
    val bankNifty = context?.bankNiftySpot?.takeIf { it.isFresh(state) }
    Section("Market context") {
        ContextReading("India VIX", "Volatility context", vix, "context-vix")
        ContextReading("BANKNIFTY spot", "Research context", bankNifty, "context-banknifty")
    }
}

@Composable private fun ContextReading(label: String, purpose: String, quote: ReferenceQuote?, tag: String) {
    Text("$label: ${format(quote?.price)}", modifier = Modifier.testTag(tag))
    val change = quote?.let { reading ->
        reading.previousClose?.let { (reading.price / it - 1) * 100 }
    }?.takeIf { it.isFinite() }
    if (change != null) Text("${signed(change)}% vs broker previous close", color = Muted)
    Text("$purpose · Source: ${at(quote?.observedAt)}",
        color = Muted, style = MaterialTheme.typography.bodySmall)
}

@Composable private fun MarketReferenceCard(state: MarketUiState) {
    val reference = state.current?.references?.get(state.selected)
    val spot = reference?.spot?.takeIf { reference.eligible(state, it) }
    val future = reference?.future?.takeIf { reference.eligible(state, it) }
    Section("Market references · broker snapshot") {
        Text("${state.selected.name} · Spot references", color = Gold)
        Text("Broker previous close: ${format(spot?.previousClose)}", modifier = Modifier.testTag("reference-pdc"))
        Text("Today's open: ${format(spot?.dayOpen)}")
        Text("Today's session high: ${format(spot?.dayHigh)}")
        Text("Today's session low: ${format(spot?.dayLow)}")
        Text("Futures: ${format(future?.price)}", modifier = Modifier.testTag("reference-future"))
        Text("Futures contract: ${future?.contract ?: "Unavailable"} · expiry ${future?.expiry ?: "Unavailable"}",
            color = Muted, modifier = Modifier.testTag("reference-future-contract"))
        Text("Basis (future − spot): ${format(reference?.basis(state))} index points",
            modifier = Modifier.testTag("reference-basis"))
        Text("Spot source: ${at(spot?.observedAt)} · Futures source: ${at(future?.observedAt)}",
            color = Muted, style = MaterialTheme.typography.bodySmall)
        Text("PDH / PDL / VWAP: unavailable. Today's high/low are current-session values.",
            color = Muted, style = MaterialTheme.typography.bodySmall)
    }
}

@Composable private fun PcrCard(state: MarketUiState) {
    val reading = state.current?.pcrReadings?.get(state.selected)
    val eligible = reading?.eligible(state) == true
    Section("PCR & OI · source snapshots") {
        Text("${state.selected.name} · Expiry ${reading?.expiry ?: "Unavailable"}", color = Muted)
        fun ratio(value: Double?): String = value?.let {
            String.format(Locale.ENGLISH, "%.4f", it)
        } ?: "—"
        val full = if (eligible) reading?.full else null
        val band = if (eligible) reading?.band else null
        val reported = if (eligible) reading?.reported else null
        Text("Full PCR · verified snapshot: ${ratio(full?.ratio)}",
            modifier = Modifier.testTag("full-pcr"), color = Gold)
        if (full != null) Text("CE OI ${strikeText(full.ceOi)} · PE OI ${strikeText(full.peOi)}")
        Text("ATM ±7 band PCR · 15 strikes: ${ratio(band?.ratio)}",
            modifier = Modifier.testTag("band-pcr"))
        if (band != null) {
            Text("Band ${strikeText(band.fromStrike!!)}–${strikeText(band.toStrike!!)} · frozen ATM ${strikeText(band.anchorStrike!!)}", color = Muted)
            Text("Band CE OI ${strikeText(band.ceOi)} · PE OI ${strikeText(band.peOi)}")
        }
        Text("Full PCR · latest reported: ${ratio(reported?.ratio)}",
            modifier = Modifier.testTag("reported-pcr"))
        if (reported != null) {
            Text("Reported CE OI ${strikeText(reported.ceOi)} · PE OI ${strikeText(reported.peOi)}")
            Text("Mixed source timestamps · ${reported.olderAtCheck} quotes older than 30s at check. Not fresh/synchronized PCR.",
                color = Muted, style = MaterialTheme.typography.bodySmall)
        }
        if (reading != null) {
            Text("Checked: ${at(reading.checkedAt)}", color = Muted, style = MaterialTheme.typography.bodySmall)
            if (reading.expected != null && reading.freshOi != null)
                Text("Fresh OI at source check: ${reading.freshOi}/${reading.expected} contracts", color = Muted,
                    style = MaterialTheme.typography.bodySmall)
            val source = full ?: reported ?: band
            if (source != null) Text("OI source times: ${at(source.sourceMinAt)} → ${at(source.sourceMaxAt)}", color = Muted,
                style = MaterialTheme.typography.bodySmall)
            if (!eligible) Text("Snapshot expired or disconnected. Refresh or start updates.", color = Muted)
            else if (full == null) Text(reading.sourceReason, color = Muted)
        } else Text("No qualified PCR snapshot. Refresh or start updates during the operating window.", color = Muted)
        Text("PCR expiry is shown above; the ATM-card expiry filter below does not change it.",
            color = Muted, style = MaterialTheme.typography.labelSmall)
        Text("Full means the backend's subscribed expiry inventory. Band and reported values are separate; no bullish/bearish trade signal is inferred.",
            color = Muted, style = MaterialTheme.typography.labelSmall)
    }
}
@Composable private fun PremiumCell(side: String, leg: PremiumLeg?, state: MarketUiState, modifier: Modifier) {
    val eligible = leg?.eligible(state) == true
    Column(modifier.background(Navy, RoundedCornerShape(10.dp)).padding(10.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
        Text(side, color = Gold, fontWeight = FontWeight.SemiBold)
        Text("₹${format(if (eligible) leg?.price else null)}", style = MaterialTheme.typography.titleLarge)
        if (eligible && leg?.changePct != null) Text("${signed(leg.changePct)}%", color = if (leg.changePct >= 0) Up else Down)
        Text(if (eligible) "Recent quote" else "Unavailable / delayed", color = Muted, style = MaterialTheme.typography.labelSmall)
        Text(at(leg?.observedAt), color = Muted, style = MaterialTheme.typography.labelSmall)
    }
}
@Composable private fun QuoteCard(state: MarketUiState) {
    Section(state.selected.name + " · snapshot") {
        val recent = state.status == ReadingStatus.RECENT_SNAPSHOT
        Text(when(state.status) { ReadingStatus.RECENT_SNAPSHOT -> if (state.updatesWanted && state.updatePhase == UpdatePhase.RECEIVING) "RECENT STREAM SNAPSHOT" else "RECENT SNAPSHOT — NOT A CONTINUOUS STREAM"
            ReadingStatus.STALE -> "STALE / REFRESH REQUIRED"; ReadingStatus.CACHED -> "SAVED READING AVAILABLE IN MEMORY"
            ReadingStatus.UNAVAILABLE -> "NO ELIGIBLE READING" }, color = Gold, style = MaterialTheme.typography.labelMedium)
        Text(if(recent) "₹${format(state.quote?.price)}" else "—", style = MaterialTheme.typography.displaySmall)
        val change = if(recent) state.quote?.changePct else null
        if(change != null) Text("${signed(change)}% vs previous close", color = if(change >= 0) Up else Down)
        Text("Source time: ${at(state.quote?.observedAt)}", color = Muted)
        Text("Server time: ${at(state.current?.serverTime)}", color = Muted)
        state.snapshotRequestMs?.let {
            Text("Snapshot fetch + decode: ${it / 1000.0}s", color = Muted)
            Text("Delivery age budget: ${state.deliveryAgeMs / 1000.0}s · conservative, not exact feed latency", color = Muted,
                style = MaterialTheme.typography.bodySmall)
        }
        Text("Quote age at server snapshot: ${state.quote?.sourceAgeMs?.let { "${it / 1000.0}s" } ?: "Unknown"}", color = Muted)
    }
}
@Composable private fun Section(title: String, content: @Composable ColumnScope.() -> Unit) {
    Card(colors = CardDefaults.cardColors(containerColor = Panel), shape = RoundedCornerShape(18.dp), modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(17.dp), verticalArrangement = Arrangement.spacedBy(9.dp)) {
            Text(title, color = Gold, style = MaterialTheme.typography.titleMedium)
            content()
        }
    }
}
private fun ratioText(value: Double): String = String.format(Locale.ROOT, "%.4f", value)
private fun strikeText(value: Double): String = NumberFormat.getNumberInstance(Locale.forLanguageTag("en-IN")).apply { maximumFractionDigits = 2 }.format(value)
private fun shortExpiry(value: String): String = LocalDate.parse(value).format(DateTimeFormatter.ofPattern("dd MMM", Locale.ENGLISH))
private fun format(value: Double?): String = value?.let { NumberFormat.getNumberInstance(Locale.forLanguageTag("en-IN")).apply {
    minimumFractionDigits = 2; maximumFractionDigits = 2
}.format(it) } ?: "—"
private fun signed(value: Double): String = (if(value >= 0) "+" else "") + format(value)
private fun at(value: String?): String = try {
    value?.let { DateTimeFormatter.ofPattern("dd MMM yyyy · HH:mm:ss 'IST'").withZone(ZoneId.of("Asia/Kolkata")).format(Instant.parse(it)) } ?: "Unavailable"
} catch (_: Exception) { "Invalid source time" }

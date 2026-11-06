package com.marketcapsule.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
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
    CapsuleScreen(state, vm::select, vm::refresh, vm::setUpdatesWanted, vm::loadStrikes)
}
@Composable internal fun CapsuleScreen(state: MarketUiState, onSelect: (MarketIndex) -> Unit, onRefresh: () -> Unit, onUpdatesWanted: (Boolean) -> Unit = {}, onLoadStrikes: (MarketIndex, String) -> Unit = { _, _ -> }) {
    var page by rememberSaveable { mutableStateOf(Page.TODAY) }
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
        LazyColumn(modifier = Modifier.testTag("screen-content").fillMaxSize().padding(padding), contentPadding = PaddingValues(18.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp)) {
            item {
                Text("Market Capsule", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.SemiBold)
                Text("ନିଜ marketକୁ ପ୍ରମାଣ ସହ ବୁଝନ୍ତୁ", color = Muted)
                Spacer(Modifier.height(12.dp))
                Text("TEST 0.1.7 · READ ONLY · NO TRADING", color = Gold, style = MaterialTheme.typography.labelMedium)
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    MarketIndex.entries.forEach { symbol -> FilterChip(selected = state.selected == symbol,
                        modifier = Modifier.testTag("index-${symbol.name}"), onClick = { onSelect(symbol) }, label = { Text(symbol.name) }) }
                }
            }
            if (page == Page.TODAY || page == Page.DESK) {
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
                }
            }
            when(page) {
                Page.TODAY -> {
                    item { Section("What changed · verified observation") {
                        val quote = state.quote
                        if (state.status == ReadingStatus.RECENT_SNAPSHOT && quote?.changePct != null) {
                            Text("${state.selected.name}: ${signed(quote.changePct)}% versus broker previous close.")
                            Text("ଏହା day change; latest intraday movement କିମ୍ବା buyingର କାରଣ ନୁହେଁ।", color = Muted)
                        } else Text("Current eligible observation unavailable. Refresh or open Memory for the last saved reading.")
                    } }
                    item { Section("Why / Watch next") {
                        Text("News, historical matching and AI explanations are pending integration.")
                        Text("No market cause, trade suggestion or prediction is generated by this foundation.", color = Muted)
                    } }
                    item { Section("Source coverage") {
                        Text("Snapshot source: Kite FULL via existing OptionPilot backend.")
                        Text("Multi-expiry ATM premiums: Live Desk. Full PCR, sector weights and FII/DII remain pending.", color = Muted)
                    } }
                }
                Page.DESK -> {
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
                                Text("CE premium               STRIKE               PE premium",
                                    color = Muted, style = MaterialTheme.typography.labelSmall)
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
private fun strikeText(value: Double): String = NumberFormat.getNumberInstance(Locale.forLanguageTag("en-IN")).apply { maximumFractionDigits = 2 }.format(value)
private fun shortExpiry(value: String): String = LocalDate.parse(value).format(DateTimeFormatter.ofPattern("dd MMM", Locale.ENGLISH))
private fun format(value: Double?): String = value?.let { NumberFormat.getNumberInstance(Locale.forLanguageTag("en-IN")).apply {
    minimumFractionDigits = 2; maximumFractionDigits = 2
}.format(it) } ?: "—"
private fun signed(value: Double): String = (if(value >= 0) "+" else "") + format(value)
private fun at(value: String?): String = try {
    value?.let { DateTimeFormatter.ofPattern("dd MMM yyyy · HH:mm:ss 'IST'").withZone(ZoneId.of("Asia/Kolkata")).format(Instant.parse(it)) } ?: "Unavailable"
} catch (_: Exception) { "Invalid source time" }

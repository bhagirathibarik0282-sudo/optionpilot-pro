package com.marketcapsule.app

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import java.time.Duration

internal class ReplayPanelState {
    var sessions by mutableStateOf<List<RecordedSession>?>(null)
    var index by mutableStateOf(ReplayIndex.NIFTY)
    var session by mutableStateOf<RecordedSession?>(null)
    var window by mutableStateOf<ReplayWindow?>(null)
    var data by mutableStateOf<RecordedWindow?>(null)
    var busy by mutableStateOf(false)
    var error by mutableStateOf<String?>(null)

    fun select(value: RecordedSession?) {
        session = value
        window = null
        data = null
        error = null
    }

    suspend fun load(action: suspend () -> Unit) {
        busy = true
        error = null
        try {
            action()
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (failure: Exception) {
            error = when (failure.message) {
                "REPLAY_OUTSIDE_HOURS" -> "Recorded data server is outside operating hours. Try during its operating window."
                "REPLAY_STARTING" -> "Recorded data server is starting. Try again shortly."
                "RESPONSE_TOO_LARGE" -> "This replay window is too large to load."
                "APP_AUTHENTICATION_REQUIRED" -> "Recorded data requires access."
                "VIEWER_OR_RATE_LIMIT" -> "Recorded data is temporarily rate limited."
                "NETWORK_UNAVAILABLE" -> "Could not reach the recorded data server."
                else -> "Recorded data could not be verified or loaded."
            }
        } finally {
            busy = false
        }
    }
}

@Composable
internal fun ReplayPanel(
    state: ReplayPanelState,
    onCatalog: () -> Unit,
    onWindow: (ReplayWindow) -> Unit,
) {
    var menu by remember { mutableStateOf(false) }
    val dates = state.sessions.orEmpty().filter { it.index == state.index }
    Section("Recorded sessions · Replay") {
        Text("Historical data · IST · read only")
        OutlinedButton(onClick = onCatalog, enabled = !state.busy, modifier = Modifier.testTag("replay-catalog")) {
            Text(if (state.sessions == null) "Load recorded dates" else "Refresh recorded dates")
        }
        if (state.busy) Text("Loading recorded data…")
        state.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        if (state.sessions == null) return@Section
        Row(horizontalArrangement = Arrangement.spacedBy(5.dp)) {
            ReplayIndex.entries.forEach { index ->
                FilterChip(selected = state.index == index, enabled = !state.busy, onClick = {
                    state.index = index
                    state.select(state.sessions?.firstOrNull { it.index == index })
                }, label = { Text(index.name) })
            }
        }
        Text("${dates.size} recorded dates for ${state.index.name}")
        if (dates.isEmpty()) return@Section
        OutlinedButton(onClick = { menu = true }, enabled = !state.busy, modifier = Modifier.testTag("replay-date")) {
            Text(state.session?.date?.toString() ?: "Choose recorded date")
        }
        DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
            dates.forEach { session ->
                DropdownMenuItem(text = { Text(session.date.toString()) }, onClick = {
                    menu = false
                    state.select(session)
                })
            }
        }
        state.session?.let { session ->
            Button(onClick = { onWindow(session.window()) }, enabled = !state.busy,
                modifier = Modifier.fillMaxWidth().testTag("replay-start")) { Text("Replay") }
        }
        state.window?.let { window ->
            Text("${replayTime(window.from)}–${replayTime(window.to)} IST · recorded window")
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                window.previous?.let { previous ->
                    TextButton(onClick = { onWindow(previous) }, enabled = !state.busy) { Text("Earlier") }
                }
                window.next?.let { next ->
                    TextButton(onClick = { onWindow(next) }, enabled = !state.busy) { Text("Later") }
                }
                if (state.error != null) {
                    TextButton(onClick = { onWindow(window) }, enabled = !state.busy) { Text("Retry") }
                }
            }
        }
        state.data?.let { data -> ReplayFrames(data) }
    }
}

@Composable
private fun ReplayFrames(data: RecordedWindow) {
    val frames = data.frames
    if (frames.isEmpty()) {
        Text("No recorded rows in this window.")
        return
    }
    var position by remember(data) { mutableIntStateOf(0) }
    var playing by remember(data) { mutableStateOf(false) }
    var table by remember(data) { mutableStateOf(ReplayTable.MARKET) }
    var rowIndex by remember(data, position, table) { mutableIntStateOf(0) }
    var showFields by remember(data, position, table, rowIndex) { mutableStateOf(false) }
    LaunchedEffect(playing, data) {
        while (playing && position < frames.lastIndex) {
            delay(900)
            position++
        }
        playing = false
    }
    val frame = frames[position]
    Text("Recorded at ${at(frame.time.toString())}", modifier = Modifier.testTag("replay-time"))
    Text("${position + 1}/${frames.size} observations · accelerated playback")
    if (position > 0) {
        val gap = Duration.between(frames[position - 1].time, frame.time).toMinutes()
        if (gap > 3) Text("Gap from previous observation: $gap minutes")
    }
    Row(horizontalArrangement = Arrangement.spacedBy(5.dp)) {
        TextButton(onClick = { playing = false; position-- }, enabled = position > 0) { Text("Previous") }
        TextButton(onClick = { playing = !playing }, enabled = position < frames.lastIndex) {
            Text(if (playing) "Pause" else "Play")
        }
        TextButton(onClick = { playing = false; position++ }, enabled = position < frames.lastIndex) { Text("Next") }
    }
    Row(horizontalArrangement = Arrangement.spacedBy(5.dp)) {
        ReplayTable.entries.forEach { kind ->
            FilterChip(selected = table == kind, onClick = { table = kind }, label = { Text(kind.label) })
        }
    }
    val rows = frame.rows[table].orEmpty()
    if (rows.isEmpty()) {
        Text("No ${table.label.lowercase()} rows recorded at this time.")
        return
    }
    val row = rows[rowIndex]
    Text(when (table) {
        ReplayTable.MARKET -> "Spot ${row["spot_ltp"] ?: "—"} · Futures ${row["future_ltp"] ?: "—"}"
        ReplayTable.CHAIN -> "${row["expiry"] ?: "—"} · Recorded full PCR ${row["full_chain_oi_pcr"] ?: "—"}"
        ReplayTable.OPTIONS -> "${row["expiry"] ?: "—"} · ${row["strike"] ?: "—"} ${row["option_type"] ?: "—"} · Premium ${row["ltp"] ?: "—"}"
    })
    Text("Row ${rowIndex + 1}/${rows.size}")
    if (rows.size > 1) {
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            TextButton(onClick = { rowIndex-- }, enabled = rowIndex > 0) { Text("Previous row") }
            TextButton(onClick = { rowIndex++ }, enabled = rowIndex < rows.lastIndex) { Text("Next row") }
        }
    }
    TextButton(onClick = { showFields = !showFields }) { Text(if (showFields) "Hide fields" else "Show recorded fields") }
    if (showFields) row.forEach { (label, value) -> Text("${label.replace('_', ' ')}: $value") }
}

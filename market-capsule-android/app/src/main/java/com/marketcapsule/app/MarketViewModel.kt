package com.marketcapsule.app

import android.app.Application
import android.os.SystemClock
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlin.random.Random

internal class MarketViewModel @JvmOverloads constructor(
    application: Application,
    private val repository: MarketSource = MarketRepository(application)
) : AndroidViewModel(application) {
    private val mutable = MutableStateFlow(MarketUiState())
    val state = mutable.asStateFlow()
    private var refreshJob: Job? = null
    private var ageJob: Job? = null
    private var streamJob: Job? = null
    private var strikeJob: Job? = null
    private var foreground = false
    private var watermark: MarketSnapshot? = null
    private var lastCacheElapsed: Long? = null
    init {
        viewModelScope.launch {
            val saved = repository.loadSaved()
            mutable.update { it.copy(saved = it.saved ?: saved) }
        }
    }
    fun setForeground(active: Boolean) {
        if (foreground == active) return
        foreground = active
        ageJob?.cancel(); ageJob = null
        if (!active) {
            refreshJob?.cancel()
            streamJob?.cancel()
            strikeJob?.cancel()
            if (mutable.value.updatesWanted) invalidate(UpdatePhase.PAUSED, "Updates paused in background. Saved readings remain historical.")
            return
        }
        mutable.update { it.copy(currentElapsedMs = SystemClock.elapsedRealtime()) }
        ageJob = viewModelScope.launch {
            while (true) {
                delay(1000)
                if (mutable.value.current != null) mutable.update { it.copy(currentElapsedMs = SystemClock.elapsedRealtime()) }
            }
        }
        if (mutable.value.updatesWanted) startStream()
    }
    fun select(index: MarketIndex) {
        if (mutable.value.selected != index) {
            strikeJob?.cancel()
            mutable.update { it.copy(selected = index, strikeLadder = null, strikeLoading = false,
                strikeMessage = "Load exact strikes for the selected index and expiry.") }
        }
    }
    fun loadStrikes(index: MarketIndex, expiry: String) {
        if (!foreground || strikeJob?.isActive == true) return
        val s = mutable.value
        if (s.selected != index || s.status != ReadingStatus.RECENT_SNAPSHOT ||
            s.current?.ladders?.get(index)?.none { it.expiry == expiry } != false) return
        strikeJob = viewModelScope.launch {
            mutable.update { it.copy(strikeLoading = true, strikeLadder = null,
                strikeMessage = "Reading subscribed strikes from existing broker cache…") }
            try {
                val reading = repository.fetchStrikes(index, expiry)
                val current = mutable.value
                if (foreground && current.selected == index && current.current?.runtimeId == reading.runtimeId &&
                    current.status == ReadingStatus.RECENT_SNAPSHOT) {
                    mutable.update { it.copy(strikeLadder = reading,
                        strikeMessage = "Exact source rows received. Prices are time-limited, not trading signals.") }
                } else mutable.update { it.copy(strikeLadder = null,
                    strikeMessage = "Runtime, index or snapshot changed; old strike readings withheld.") }
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (error: Exception) {
                mutable.update { it.copy(strikeLadder = null, strikeMessage = when(error.message) {
                    "STRIKE_IDENTITY_MISMATCH", "STRIKE_DUPLICATE_CONTRACT", "STRIKE_RUNTIME_MISMATCH" ->
                        "Contract identity conflict; no strike readings were displayed."
                    "STRIKE_SOURCE_DATE_MISMATCH" -> "The response is not from today's market session."
                    else -> "Strike ladder unavailable: ${explain(error)}"
                }) }
            } finally { mutable.update { it.copy(strikeLoading = false) } }
        }
    }
    fun setUpdatesWanted(wanted: Boolean) {
        if (mutable.value.updatesWanted == wanted) return
        mutable.update { it.copy(updatesWanted = wanted) }
        if (wanted && foreground) startStream()
        else {
            streamJob?.cancel()
            invalidate(if (wanted) UpdatePhase.PAUSED else UpdatePhase.OFF,
                if (wanted) "Updates resume when the app is visible." else "Updates stopped. Saved readings remain historical.")
        }
    }
    private fun startStream() {
        val previous = streamJob
        previous?.cancel()
        refreshJob?.cancel()
        streamJob = viewModelScope.launch {
            // Join the previous socket's cancellation before opening another one.
            previous?.cancelAndJoin()
            refreshJob?.cancelAndJoin()
            var attempt = 0
            while (foreground && mutable.value.updatesWanted) {
                invalidate(UpdatePhase.CONNECTING, "Checking runtime and connecting updates…")
                try {
                    repository.ensureRuntime()
                    repository.updates().collect { fetched ->
                        if (!foreground || !mutable.value.updatesWanted) return@collect
                        applySnapshot(fetched, streaming = true)
                        attempt = 0
                    }
                    error("STREAM_CLOSED")
                } catch (cancelled: CancellationException) { throw cancelled }
                catch (error: Exception) {
                    if (!ReconnectPolicy.mayRetry(error.message)) {
                        mutable.update { it.copy(updatesWanted = false) }
                        invalidate(UpdatePhase.BLOCKED, explain(error))
                        return@launch
                    }
                    val wait = ReconnectPolicy.delayMs(attempt++, error.message == "VIEWER_OR_RATE_LIMIT") + Random.nextLong(0, 501)
                    invalidate(UpdatePhase.RETRY_WAIT, explain(error) + " Reconnecting in about ${wait / 1000}s.", wait)
                    delay(wait)
                }
            }
        }
    }
    private fun invalidate(phase: UpdatePhase, message: String, retryMs: Long = 0) {
        mutable.update { it.copy(current = null, receivedElapsedMs = null, deliveryAgeMs = 0,
            snapshotRequestMs = null, updatePhase = phase, retryAfterMs = retryMs, message = message,
            strikeLadder = null, strikeLoading = false) }
    }
    private suspend fun applySnapshot(fetched: FetchedSnapshot, streaming: Boolean) {
        val snapshot = fetched.snapshot
        if (!SnapshotParser.accepts(watermark, snapshot)) error("OUT_OF_ORDER_SNAPSHOT")
        watermark = snapshot // Retain ordering across disconnects, even while current is withheld.
        val now = SystemClock.elapsedRealtime()
        val usable = snapshot.connected && snapshot.quotes.values.any {
            it.price != null && it.sourceAgeMs != null &&
                it.sourceAgeMs + fetched.deliveryAgeMs + (now - fetched.receivedElapsedMs).coerceAtLeast(0) <= QUOTE_MAX_AGE_MS
        }
        mutable.update { it.copy(current = snapshot, saved = if (usable) snapshot else it.saved,
            strikeLadder = it.strikeLadder?.takeIf { reading -> reading.runtimeId == snapshot.runtimeId },
            receivedElapsedMs = fetched.receivedElapsedMs, currentElapsedMs = now,
            deliveryAgeMs = fetched.deliveryAgeMs, snapshotRequestMs = fetched.requestMs,
            updatePhase = if (streaming) UpdatePhase.RECEIVING else UpdatePhase.OFF, retryAfterMs = 0,
            message = if (usable) {
                if (streaming) "Receiving snapshots. Source time and data age determine whether values are recent."
                else "Snapshot received. Start updates for ongoing reads."
            } else "Broker state: ${snapshot.connectionState} · No eligible recent values after delivery checks.") }
        if (usable && (!streaming || lastCacheElapsed == null || now - lastCacheElapsed!! >= 10_000)) {
            if (repository.save(fetched.raw)) lastCacheElapsed = now
            else mutable.update { it.copy(message = it.message + " Local cache could not be saved.") }
        }
    }
    fun refresh() {
        if (mutable.value.updatesWanted || refreshJob?.isActive == true) return
        refreshJob = viewModelScope.launch {
            mutable.update { it.copy(loading = true, message = "Checking runtime and requesting a read-only snapshot…") }
            try { applySnapshot(repository.fetch(), streaming = false) }
            catch (cancelled: CancellationException) { throw cancelled }
            catch (error: Exception) { invalidate(UpdatePhase.OFF, explain(error)) }
            finally { mutable.update { it.copy(loading = false) } }
        }
    }
    private fun explain(error: Exception): String = when (error.message) {
        "OUTSIDE_OPERATING_HOURS" -> "Market runtime is outside its operating window. Start updates again during operating hours. Saved readings remain available."
        "RUNTIME_STARTING" -> "Market runtime is starting."
        "CLOCK_OR_STALE_RESPONSE" -> "Response is too old or the phone clock differs from the server. Check automatic date/time and retry; saved readings remain historical."
        "APP_AUTHENTICATION_REQUIRED" -> "Server authentication is required. Mobile sign-in integration is pending; do not enter broker/admin secrets here."
        "VIEWER_OR_RATE_LIMIT" -> "Server viewer/rate limit reached."
        "NETWORK_UNAVAILABLE", "STREAM_CLOSED", "SERVICE_UNAVAILABLE" -> "Connection interrupted or unavailable. Saved readings remain historical."
        "OUT_OF_ORDER_SNAPSHOT" -> "Older server response rejected. Restart updates to resynchronize."
        else -> "Response unavailable or rejected. Stop, check connection and retry. No values have been invented."
    }
}

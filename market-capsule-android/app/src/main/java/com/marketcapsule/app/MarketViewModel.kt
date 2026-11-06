package com.marketcapsule.app

import android.app.Application
import android.os.SystemClock
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

internal class MarketViewModel(application: Application) : AndroidViewModel(application) {
    private val repository = MarketRepository(application)
    private val mutable = MutableStateFlow(MarketUiState())
    val state = mutable.asStateFlow()
    private var refreshJob: Job? = null
    private var ageJob: Job? = null
    init {
        viewModelScope.launch {
            val saved = repository.loadSaved()
            mutable.update { it.copy(saved = it.saved ?: saved) }
        }
    }
    fun setForeground(active: Boolean) {
        ageJob?.cancel()
        ageJob = null
        if (!active) return
        mutable.update { it.copy(currentElapsedMs = SystemClock.elapsedRealtime()) }
        ageJob = viewModelScope.launch {
            while (true) {
                delay(1000)
                if (mutable.value.current != null) mutable.update { it.copy(currentElapsedMs = SystemClock.elapsedRealtime()) }
            }
        }
    }
    fun select(index: MarketIndex) { mutable.update { it.copy(selected = index) } }
    fun refresh() {
        if (refreshJob?.isActive == true) return
        refreshJob = viewModelScope.launch {
            mutable.update { it.copy(loading = true, message = "Checking runtime and requesting a read-only snapshot…") }
            try {
                val fetched = repository.fetch()
                val snapshot = fetched.snapshot
                val raw = fetched.raw
                if (!SnapshotParser.accepts(mutable.value.current, snapshot)) error("OUT_OF_ORDER_SNAPSHOT")
                val now = SystemClock.elapsedRealtime()
                val usable = snapshot.connected && snapshot.quotes.values.any {
                    it.price != null && it.sourceAgeMs != null &&
                        it.sourceAgeMs + fetched.deliveryAgeMs + (now - fetched.receivedElapsedMs).coerceAtLeast(0) <= QUOTE_MAX_AGE_MS
                }
                mutable.update { it.copy(current = snapshot, saved = if (usable) snapshot else it.saved,
                    receivedElapsedMs = fetched.receivedElapsedMs, currentElapsedMs = now,
                    deliveryAgeMs = fetched.deliveryAgeMs, snapshotRequestMs = fetched.requestMs,
                    message = if (usable) "Snapshot received · Continuous streaming is not implemented in this foundation."
                    else "Broker state: ${snapshot.connectionState} · No eligible recent values after delivery checks.") }
                if (usable && !repository.save(raw)) mutable.update { it.copy(message = it.message + " Local cache could not be saved.") }
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (error: Exception) {
                val message = when (error.message) {
                    "OUTSIDE_OPERATING_HOURS" -> "Market runtime is outside its operating window. Saved readings remain available."
                    "RUNTIME_STARTING" -> "Market runtime is starting. Retry after it becomes ready."
                    "CLOCK_OR_STALE_RESPONSE" -> "Response is too old or the phone clock differs from the server. Check automatic date/time and retry; saved readings remain historical."
                    "APP_AUTHENTICATION_REQUIRED" -> "Server authentication is required. Mobile sign-in integration is pending; do not enter broker/admin secrets here."
                    "VIEWER_OR_RATE_LIMIT" -> "Server viewer/rate limit reached. Wait before retrying."
                    "NETWORK_UNAVAILABLE" -> "Network unavailable. Showing saved readings when present."
                    "OUT_OF_ORDER_SNAPSHOT" -> "Older server response rejected. Refresh to resynchronize."
                    else -> "Snapshot unavailable or rejected. No values have been invented."
                }
                mutable.update { it.copy(current = null, receivedElapsedMs = null, deliveryAgeMs = 0, snapshotRequestMs = null, message = message) }
            } finally { mutable.update { it.copy(loading = false) } }
        }
    }
}

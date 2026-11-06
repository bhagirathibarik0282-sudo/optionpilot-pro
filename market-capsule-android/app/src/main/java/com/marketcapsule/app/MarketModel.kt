package com.marketcapsule.app

import org.json.JSONObject
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

internal const val QUOTE_MAX_AGE_MS = 30_000L
internal const val RESPONSE_MAX_AGE_MS = 5_000L
internal const val BASE_URL = "https://optionpilot-pro-v2-production.up.railway.app"
internal enum class MarketIndex { NIFTY, SENSEX }
internal enum class UpdatePhase(val label: String) {
    OFF("Updates off"), CONNECTING("Connecting"), RECEIVING("Receiving snapshots"),
    RETRY_WAIT("Waiting to reconnect"), PAUSED("Paused in background"), BLOCKED("Updates stopped — check message")
}
internal enum class ReadingStatus { RECENT_SNAPSHOT, STALE, CACHED, UNAVAILABLE }
internal data class Quote(
    val index: MarketIndex,
    val price: Double?,
    val changePct: Double?,
    val observedAt: String?,
    val receivedAt: String?,
    val sourceAgeMs: Long?,
    val state: String,
    val expiry: String?,
    val strike: Double?,
    val cePrice: Double?,
    val pePrice: Double?,
    val ceAgeMs: Long?,
    val peAgeMs: Long?
)
internal data class MarketSnapshot(
    val runtimeId: String,
    val sequence: Long,
    val serverTime: String,
    val connected: Boolean,
    val connectionState: String,
    val quotes: Map<MarketIndex, Quote>,
    val ladders: Map<MarketIndex, List<ExpiryPair>> = emptyMap()
)
internal data class MarketUiState(
    val selected: MarketIndex = MarketIndex.NIFTY,
    val current: MarketSnapshot? = null,
    val saved: MarketSnapshot? = null,
    val loading: Boolean = false,
    val message: String = "Read-only foundation · Tap Refresh to request a snapshot.",
    val receivedElapsedMs: Long? = null,
    val currentElapsedMs: Long = 0,
    val deliveryAgeMs: Long = 0,
    val snapshotRequestMs: Long? = null,
    val updatesWanted: Boolean = false,
    val updatePhase: UpdatePhase = UpdatePhase.OFF,
    val retryAfterMs: Long = 0,
    val strikeLadder: StrikeLadderRead? = null,
    val strikeLoading: Boolean = false,
    val strikeMessage: String = "Load one expiry only when a recent market snapshot is available."
) {
    val quote get() = current?.quotes?.get(selected)
    val savedQuote get() = saved?.quotes?.get(selected)
    val status: ReadingStatus get() {
        val q = quote ?: return if (savedQuote?.price != null) ReadingStatus.CACHED else ReadingStatus.UNAVAILABLE
        val elapsed = receivedElapsedMs?.let { (currentElapsedMs - it).coerceAtLeast(0) }
        return if (current?.connected == true && q.state == "LIVE" && q.price != null && elapsed != null &&
            elapsed <= RESPONSE_MAX_AGE_MS && q.sourceAgeMs != null && q.sourceAgeMs + elapsed + deliveryAgeMs <= QUOTE_MAX_AGE_MS
        ) ReadingStatus.RECENT_SNAPSHOT else ReadingStatus.STALE
    }
}
internal object SnapshotParser {
    private fun number(j: JSONObject, key: String): Double? = (j.opt(key) as? Number)?.toDouble()?.takeIf { it.isFinite() }
    private fun positive(j: JSONObject, key: String) = number(j, key)?.takeIf { it > 0 }
    private fun text(j: JSONObject, key: String) = (j.opt(key) as? String)?.takeIf { it.isNotBlank() }
    private fun instant(value: String?): Instant? = try { value?.let(Instant::parse) } catch (_: Exception) { null }
    fun parse(raw: String): MarketSnapshot {
        val root = JSONObject(raw)
        require(root.optString("source") == "KITE_WEBSOCKET_FULL") { "UNEXPECTED_SOURCE" }
        val snap = root.optJSONObject("snapshot") ?: error("SNAPSHOT_UNAVAILABLE")
        val runtime = text(snap, "runtimeId") ?: error("MISSING_RUNTIME_ID")
        val seq = number(snap, "sequence") ?: error("MISSING_SEQUENCE")
        require(seq >= 0 && seq % 1.0 == 0.0 && seq <= 9_007_199_254_740_991.0) { "INVALID_SEQUENCE" }
        val serverText = text(root, "serverTime") ?: error("MISSING_SERVER_TIME")
        val server = instant(serverText) ?: error("INVALID_SERVER_TIME")
        val connected = root.opt("connected") == true
        val array = snap.optJSONArray("indices") ?: error("MISSING_INDICES")
        val quotes = mutableMapOf<MarketIndex, Quote>()
        val seen = mutableSetOf<MarketIndex>()
        val serverDate = server.atZone(ZoneId.of("Asia/Kolkata")).toLocalDate()
        for (i in 0 until array.length()) {
            val row = array.optJSONObject(i) ?: continue
            val symbol = MarketIndex.entries.find { it.name == row.optString("symbol") } ?: continue
            require(seen.add(symbol)) { "DUPLICATE_INDEX" }
            val spot = row.optJSONObject("spot") ?: continue
            val identity = spot.optJSONObject("identity") ?: continue
            require(identity.optString("symbol") == symbol.name && identity.optString("role") == "SPOT") { "WRONG_SPOT_IDENTITY" }
            val observed = text(spot, "observedAt")
            val received = text(spot, "receivedAt")
            val age = instant(observed)?.let { java.time.Duration.between(it, server).toMillis() }
            val receiptAge = instant(received)?.let { java.time.Duration.between(it, server).toMillis() }
            val eligible = connected && spot.optString("state") == "LIVE" && age != null && age in -5_000..QUOTE_MAX_AGE_MS &&
                receiptAge != null && receiptAge in 0..QUOTE_MAX_AGE_MS && age + 5_000 >= receiptAge
            val expiry = text(row, "expiry")?.takeIf { value ->
                runCatching { LocalDate.parse(value).let { it.toString() == value && it >= serverDate } }.getOrDefault(false)
            }
            val strike = positive(row, "strike")
            fun legAge(side: String): Long? {
                val leg = row.optJSONObject(side.lowercase()) ?: return null
                val observedAge = instant(text(leg, "observedAt"))?.let { java.time.Duration.between(it, server).toMillis() }
                val receivedAge = instant(text(leg, "receivedAt"))?.let { java.time.Duration.between(it, server).toMillis() }
                return if (observedAge == null || receivedAge == null) null else maxOf(0, observedAge, receivedAge)
            }
            fun option(side: String): Double? {
                val q = row.optJSONObject(side.lowercase()) ?: return null
                val id = q.optJSONObject("identity") ?: return null
                val optionAge = instant(text(q, "observedAt"))?.let { java.time.Duration.between(it, server).toMillis() }
                val optionReceiptAge = instant(text(q, "receivedAt"))?.let { java.time.Duration.between(it, server).toMillis() }
                if (!eligible || expiry == null || strike == null || q.optString("state") != "LIVE" ||
                    id.optString("symbol") != symbol.name || id.optString("role") != "OPTION" ||
                    id.optString("side") != side || id.optString("expiry") != expiry || number(id, "strike") != strike ||
                    optionAge == null || optionAge !in -5_000..QUOTE_MAX_AGE_MS || optionReceiptAge == null || optionReceiptAge !in 0..QUOTE_MAX_AGE_MS || optionAge + 5_000 < optionReceiptAge) return null
                return positive(q, "price")
            }
            quotes[symbol] = Quote(symbol, if (eligible) positive(spot, "price") else null,
                if (eligible) number(spot, "changePct") else null, observed, received,
                if (age == null || receiptAge == null) null else maxOf(0, age, receiptAge), if (eligible) "LIVE" else "STALE", expiry, strike, option("CE"), option("PE"), legAge("CE"), legAge("PE"))
        }
        return MarketSnapshot(runtime, seq.toLong(), serverText, connected, root.optString("connectionState", "UNKNOWN"), quotes,
            ExpiryLadderParser.parse(snap, server, connected))
    }
    fun accepts(previous: MarketSnapshot?, next: MarketSnapshot): Boolean {
        if (previous == null) return true
        val priorTime = Instant.parse(previous.serverTime)
        val nextTime = Instant.parse(next.serverTime)
        if (nextTime < priorTime) return false
        return previous.runtimeId != next.runtimeId || next.sequence >= previous.sequence
    }
}

/** Conservative delivery budget, not a measurement of exchange-to-phone latency.
 * A phone clock mismatch fails closed with an explicit message; cached observations
 * bypass this current-response check and remain historical only.
 */
internal object SnapshotDelivery {
    fun ageBudget(serverTime: String, receivedWallMs: Long, requestMs: Long): Long {
        require(requestMs >= 0) { "INVALID_DELIVERY_TIMING" }
        val serverLag = receivedWallMs - Instant.parse(serverTime).toEpochMilli()
        require(serverLag in -5_000..QUOTE_MAX_AGE_MS) { "CLOCK_OR_STALE_RESPONSE" }
        return maxOf(requestMs, serverLag.coerceAtLeast(0))
    }
}
internal data class FetchedSnapshot(
    val snapshot: MarketSnapshot,
    val raw: String,
    val receivedElapsedMs: Long,
    val deliveryAgeMs: Long,
    val requestMs: Long?
)

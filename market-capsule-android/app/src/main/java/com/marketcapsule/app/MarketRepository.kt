package com.marketcapsule.app

import android.content.Context
import android.os.SystemClock
import android.util.AtomicFile
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.withContext
import kotlinx.coroutines.suspendCancellableCoroutine
import okhttp3.Call
import okhttp3.Callback
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.IOException
import java.time.Instant
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

internal interface MarketSource {
    suspend fun loadSaved(): MarketSnapshot?
    suspend fun fetch(): FetchedSnapshot
    suspend fun save(raw: String): Boolean
    suspend fun ensureRuntime()
    fun updates(): Flow<FetchedSnapshot>
    suspend fun fetchStrikes(index: MarketIndex, expiry: String): StrikeLadderRead = error("STRIKE_LADDER_UNAVAILABLE")
    suspend fun loadSavedFiiDii(): FiiDiiCashRead? = null
    suspend fun fetchFiiDii(): FetchedFiiDiiCash = error("FII_DII_UNAVAILABLE")
    suspend fun saveFiiDii(raw: String): Boolean = false
}
internal class MarketRepository(context: Context) : MarketSource {
    private val cache = AtomicFile(File(context.filesDir, "last-market-snapshot.json"))
    private val fiiDiiCache = AtomicFile(File(context.filesDir, "last-fii-dii-cash.json"))
    private val client = OkHttpClient.Builder().connectTimeout(8, TimeUnit.SECONDS)
        .readTimeout(12, TimeUnit.SECONDS).callTimeout(15, TimeUnit.SECONDS)
        .followRedirects(false).followSslRedirects(false).build()
    override suspend fun loadSaved(): MarketSnapshot? = withContext(Dispatchers.IO) {
        try { SnapshotParser.parse(cache.openRead().use { readBounded(it) }) } catch (_: Exception) { null }
    }
    override suspend fun fetch(): FetchedSnapshot {
        ensureRuntime()
        val requestWall = System.currentTimeMillis()
        val requestElapsed = SystemClock.elapsedRealtime()
        val raw = get("/api/research/dashboard-live")
        return withContext(Dispatchers.Default) {
            val snapshot = SnapshotParser.parse(raw)
            val received = SystemClock.elapsedRealtime()
            val requestMs = received - requestElapsed
            val budget = SnapshotDelivery.ageBudget(snapshot.serverTime, requestWall + requestMs, requestMs)
            FetchedSnapshot(snapshot, raw, received, budget, requestMs)
        }
    }
    override suspend fun fetchStrikes(index: MarketIndex, expiry: String): StrikeLadderRead {
        require(Regex("\\d{4}-\\d{2}-\\d{2}").matches(expiry)) { "INVALID_EXPIRY" }
        ensureRuntime()
        val requestElapsed = SystemClock.elapsedRealtime()
        val path = "/api/research/dashboard-live/premiums?view=ladder&nearby=7&symbol=${index.name}&expiries=$expiry"
        val raw = get(path)
        val receivedElapsed = SystemClock.elapsedRealtime()
        val receivedWall = System.currentTimeMillis()
        return withContext(Dispatchers.Default) {
            StrikeLadderParser.parse(raw, index, expiry, receivedWall, receivedElapsed,
                (receivedElapsed - requestElapsed).coerceAtLeast(0))
        }
    }
    override suspend fun ensureRuntime() {
        val runtimeRaw = get("/ops/runtime-status")
        val runtime = withContext(Dispatchers.Default) { JSONObject(runtimeRaw) }
        if (runtime.opt("shouldRun") != true) error("OUTSIDE_OPERATING_HOURS")
        if (runtime.opt("ready") != true) error("RUNTIME_STARTING")
    }
    override fun updates(): Flow<FetchedSnapshot> = SnapshotStream(client, elapsedClock = SystemClock::elapsedRealtime)
        .packets().map { packet ->
            withContext(Dispatchers.Default) {
                val snapshot = SnapshotParser.parse(packet.raw)
                // Per-frame clock age; the age of the entire SSE connection is not delivery time.
                val budget = SnapshotDelivery.ageBudget(snapshot.serverTime, packet.receivedWallMs, 0)
                FetchedSnapshot(snapshot, packet.raw, packet.receivedElapsedMs, budget, null)
            }
        }
    override suspend fun loadSavedFiiDii(): FiiDiiCashRead? = withContext(Dispatchers.IO) {
        runCatching {
            FiiDiiCashParser.parse(fiiDiiCache.openRead().use { readBounded(it) }, Instant.now())
        }.getOrNull()
    }
    override suspend fun fetchFiiDii(): FetchedFiiDiiCash {
        val (status, raw) = getResponse("/api/research/fii-dii/production-readiness", allowUnavailable = true)
        return withContext(Dispatchers.Default) {
            FetchedFiiDiiCash(FiiDiiCashParser.parse(raw, Instant.now(), status), raw)
        }
    }
    override suspend fun saveFiiDii(raw: String): Boolean = saveAtomic(fiiDiiCache, raw)
    override suspend fun save(raw: String): Boolean = saveAtomic(cache, raw)

    private suspend fun saveAtomic(target: AtomicFile, raw: String) = withContext(Dispatchers.IO) {
        var stream: java.io.FileOutputStream? = null
        try {
            stream = target.startWrite()
            stream.write(raw.toByteArray(Charsets.UTF_8))
            target.finishWrite(stream)
            true
        } catch (_: Exception) {
            stream?.let { target.failWrite(it) }
            false
        }
    }
    private suspend fun get(path: String): String = getResponse(path).second

    private suspend fun getResponse(path: String, allowUnavailable: Boolean = false): Pair<Int, String> =
        suspendCancellableCoroutine { continuation ->
            val call = client.newCall(Request.Builder().url(BASE_URL + path)
                .header("Accept", "application/json").header("Cache-Control", "no-cache").get().build())
            continuation.invokeOnCancellation { call.cancel() }
            call.enqueue(object : Callback {
                override fun onFailure(call: Call, e: IOException) {
                    if (continuation.isActive) continuation.resumeWithException(IOException("NETWORK_UNAVAILABLE"))
                }
                override fun onResponse(call: Call, response: Response) {
                    try {
                        response.use {
                            val text = it.body?.byteStream()?.use(::readBounded) ?: error("EMPTY_RESPONSE")
                            if (!it.isSuccessful && !(allowUnavailable && it.code == 503)) error(when (it.code) {
                                401, 403 -> "APP_AUTHENTICATION_REQUIRED"
                                429 -> "VIEWER_OR_RATE_LIMIT"
                                503 -> "SERVICE_UNAVAILABLE"
                                else -> "HTTP_${it.code}"
                            })
                            if (continuation.isActive) continuation.resume(it.code to text)
                        }
                    } catch (error: Exception) {
                        if (continuation.isActive) continuation.resumeWithException(error)
                    }
                }
            })
        }
    private fun readBounded(input: java.io.InputStream): String {
        val output = ByteArrayOutputStream()
        val buffer = ByteArray(8192)
        while (true) {
            val count = input.read(buffer)
            if (count < 0) break
            require(output.size() + count <= 4 * 1024 * 1024) { "RESPONSE_TOO_LARGE" }
            output.write(buffer, 0, count)
        }
        return output.toString(Charsets.UTF_8.name())
    }
}

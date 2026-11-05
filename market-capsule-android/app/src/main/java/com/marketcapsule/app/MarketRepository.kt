package com.marketcapsule.app

import android.content.Context
import android.util.AtomicFile
import kotlinx.coroutines.Dispatchers
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
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

internal class MarketRepository(context: Context) {
    private val cache = AtomicFile(File(context.filesDir, "last-market-snapshot.json"))
    private val client = OkHttpClient.Builder().connectTimeout(8, TimeUnit.SECONDS)
        .readTimeout(12, TimeUnit.SECONDS).callTimeout(15, TimeUnit.SECONDS)
        .followRedirects(false).followSslRedirects(false).build()
    suspend fun loadSaved(): MarketSnapshot? = withContext(Dispatchers.IO) {
        try { SnapshotParser.parse(cache.openRead().use { readBounded(it) }) } catch (_: Exception) { null }
    }
    suspend fun fetch(): Pair<MarketSnapshot, String> {
        val runtimeRaw = get("/ops/runtime-status")
        val runtime = withContext(Dispatchers.Default) { JSONObject(runtimeRaw) }
        if (runtime.opt("shouldRun") != true) error("OUTSIDE_OPERATING_HOURS")
        if (runtime.opt("ready") != true) error("RUNTIME_STARTING")
        val raw = get("/api/research/dashboard-live")
        return withContext(Dispatchers.Default) { SnapshotParser.parse(raw) } to raw
    }
    suspend fun save(raw: String) = withContext(Dispatchers.IO) {
        var stream: java.io.FileOutputStream? = null
        try {
            stream = cache.startWrite()
            stream.write(raw.toByteArray(Charsets.UTF_8))
            cache.finishWrite(stream)
            true
        } catch (_: Exception) {
            stream?.let { cache.failWrite(it) }
            false
        }
    }
    private suspend fun get(path: String): String = suspendCancellableCoroutine { continuation ->
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
                        if (!it.isSuccessful) error(when (it.code) {
                            401, 403 -> "APP_AUTHENTICATION_REQUIRED"
                            429 -> "VIEWER_OR_RATE_LIMIT"
                            503 -> "SERVICE_UNAVAILABLE"
                            else -> "HTTP_${it.code}"
                        })
                        if (continuation.isActive) continuation.resume(text)
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

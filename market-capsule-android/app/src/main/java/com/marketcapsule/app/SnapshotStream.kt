package com.marketcapsule.app

import java.io.EOFException
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.buffer
import kotlinx.coroutines.flow.callbackFlow
import okhttp3.Call
import okhttp3.Callback
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response

private class StreamHttpFailure(reason: String) : IOException(reason)

internal const val MAX_STREAM_FRAME = 4 * 1024 * 1024
internal data class StreamPacket(val raw: String, val receivedWallMs: Long, val receivedElapsedMs: Long)

/** Only complete named snapshot events are accepted. IDs are not replay cursors. */
internal class SnapshotEventDecoder(private val limit: Int = MAX_STREAM_FRAME) {
    private var event = ""
    private val data = StringBuilder()
    private var size = 0
    private var first = true
    fun line(input: String): String? {
        val line = if (first) input.removePrefix("\uFEFF") else input
        first = false
        if (line.isEmpty()) {
            val result = if (event == "snapshot" && data.isNotEmpty()) data.toString().removeSuffix("\n") else null
            event = ""; data.setLength(0); size = 0
            return result
        }
        size += line.length + 1
        require(size <= limit) { "STREAM_FRAME_TOO_LARGE" }
        if (line.startsWith(":")) return null
        val field = line.substringBefore(':')
        val value = if (':' in line) line.substringAfter(':').removePrefix(" ") else ""
        when (field) {
            "event" -> event = value
            "data" -> { data.append(value); data.append('\n') }
        }
        return null
    }
}

internal class SnapshotStream(
    client: OkHttpClient,
    private val baseUrl: String = BASE_URL,
    private val wallClock: () -> Long = System::currentTimeMillis,
    private val elapsedClock: () -> Long = { System.nanoTime() / 1_000_000 }
) {
    private val client = client.newBuilder().callTimeout(0, TimeUnit.SECONDS)
        .readTimeout(12, TimeUnit.SECONDS).followRedirects(false).followSslRedirects(false).build()
    fun packets(): Flow<StreamPacket> = callbackFlow {
        val call = client.newCall(Request.Builder().url(baseUrl + "/api/research/dashboard-live/stream")
            .header("Accept", "text/event-stream").header("Cache-Control", "no-cache").get().build())
        call.enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) { close(IOException("NETWORK_UNAVAILABLE")) }
            override fun onResponse(call: Call, response: Response) {
                try {
                    response.use {
                        if (!it.isSuccessful) throw StreamHttpFailure(when (it.code) {
                            401, 403 -> "APP_AUTHENTICATION_REQUIRED"
                            429 -> "VIEWER_OR_RATE_LIMIT"
                            in 500..599 -> "SERVICE_UNAVAILABLE"
                            else -> "STREAM_HTTP_${it.code}"
                        })
                        require(it.header("Content-Type")?.substringBefore(';')?.trim()
                            ?.equals("text/event-stream", ignoreCase = true) == true) { "INVALID_STREAM_TYPE" }
                        val source = it.body?.source() ?: error("EMPTY_STREAM")
                        val decoder = SnapshotEventDecoder()
                        while (!call.isCanceled()) {
                            val line = try { source.readUtf8LineStrict(MAX_STREAM_FRAME.toLong()) }
                            catch (e: EOFException) {
                                require(source.buffer.size <= MAX_STREAM_FRAME) { "STREAM_FRAME_TOO_LARGE" }
                                throw e
                            }
                            decoder.line(line)?.let { raw ->
                                trySend(StreamPacket(raw, wallClock(), elapsedClock()))
                            }
                        }
                    }
                    close(IOException("STREAM_CLOSED"))
                } catch (_: EOFException) { close(IOException("STREAM_CLOSED")) }
                catch (error: Exception) { close(if (error is StreamHttpFailure) error else if (error is IOException) IOException("NETWORK_UNAVAILABLE") else error) }
            }
        })
        awaitClose { call.cancel() }
    }.buffer(Channel.CONFLATED) // Latest complete snapshot; never accumulate tick history in the UI.
}

internal object ReconnectPolicy {
    fun delayMs(attempt: Int, rateLimited: Boolean = false): Long =
        if (rateLimited) 30_000 else minOf(30_000L, 2_000L * (1L shl attempt.coerceIn(0, 4)))
    fun mayRetry(reason: String?): Boolean = reason in setOf(
        "NETWORK_UNAVAILABLE", "STREAM_CLOSED", "SERVICE_UNAVAILABLE", "RUNTIME_STARTING", "VIEWER_OR_RATE_LIMIT")
}

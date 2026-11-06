package com.marketcapsule.app

import java.util.concurrent.TimeUnit
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.collect
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.*
import org.junit.Test

class SnapshotStreamTest {
    @Test fun decoderAcceptsOnlyCompleteNamedSnapshotsAndResetsFields() {
        val d = SnapshotEventDecoder()
        assertNull(d.line("\uFEFF: heartbeat"))
        d.line("event: snapshot"); d.line("data: {\"a\":"); d.line("data: 1}")
        assertEquals("{\"a\":\n1}", d.line(""))
        d.line("data: ignored without named event"); assertNull(d.line(""))
        d.line("event: news"); d.line("data: ignored"); assertNull(d.line(""))
        d.line("event: snapshot"); d.line("data: unfinished")
        // No blank line means no dispatch; a dropped connection cannot publish this event.
    }
    @Test(expected = IllegalArgumentException::class) fun decoderRejectsOversizedFrames() {
        SnapshotEventDecoder(10).line("data: too large")
    }
    @Test fun reconnectIsBoundedAndDoesNotRetryAuthOrMalformedPayloads() {
        assertEquals(2000L, ReconnectPolicy.delayMs(0))
        assertEquals(8000L, ReconnectPolicy.delayMs(2))
        assertEquals(30000L, ReconnectPolicy.delayMs(100))
        assertEquals(30000L, ReconnectPolicy.delayMs(0, true))
        assertTrue(ReconnectPolicy.mayRetry("NETWORK_UNAVAILABLE"))
        assertFalse(ReconnectPolicy.mayRetry("APP_AUTHENTICATION_REQUIRED"))
        assertFalse(ReconnectPolicy.mayRetry("OUTSIDE_OPERATING_HOURS"))
        assertFalse(ReconnectPolicy.mayRetry("INVALID_STREAM_TYPE"))
        assertFalse(ReconnectPolicy.mayRetry("CLOCK_OR_STALE_RESPONSE"))
    }
    @Test fun fragmentedHttpStreamDeliversSnapshotAndCancellationReleasesCall() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setHeader("Content-Type", "text/event-stream; charset=utf-8")
                .setChunkedBody(": heartbeat\r\nevent: snapshot\r\ndata: {\"symbol\":\"NIFTY\"}\r\n\r\n", 1))
            server.start()
            val client = OkHttpClient()
            val packet = withTimeout(5000) { SnapshotStream(client, server.url("/").toString().removeSuffix("/")).packets().first() }
            assertEquals("{\"symbol\":\"NIFTY\"}", packet.raw)
            assertEquals("/api/research/dashboard-live/stream", server.takeRequest().path)
            withTimeout(5000) { while (client.dispatcher.runningCallsCount() != 0) delay(10) }
        }
    }
    @Test fun unauthorizedResponseKeepsItsMeaningForTheController() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setResponseCode(401)); server.start()
            val failure = runCatching { withTimeout(5000) {
                SnapshotStream(OkHttpClient(), server.url("/").toString().removeSuffix("/")).packets().first()
            } }.exceptionOrNull()
            assertEquals("APP_AUTHENTICATION_REQUIRED", failure?.message)
        }
    }
    @Test fun htmlResponseCannotBecomeMarketData() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setHeader("Content-Type", "text/html").setBody("login page")); server.start()
            val failure = runCatching { withTimeout(5000) {
                SnapshotStream(OkHttpClient(), server.url("/").toString().removeSuffix("/")).packets().first()
            } }.exceptionOrNull()
            assertEquals("INVALID_STREAM_TYPE", failure?.message)
        }
    }
    @Test fun partialEventIsNotPublishedAtEof() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setHeader("Content-Type", "text/event-stream")
                .setBody("event: snapshot\ndata: partial\n")); server.start()
            var seen = false
            val failure = runCatching { withTimeout(5000) {
                SnapshotStream(OkHttpClient(), server.url("/").toString().removeSuffix("/")).packets().collect { seen = true }
            } }.exceptionOrNull()
            assertFalse(seen); assertEquals("STREAM_CLOSED", failure?.message)
        }
    }
    @Test fun cancelBeforeFirstFrameClosesPendingNetworkCall() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setHeadersDelay(2, TimeUnit.SECONDS).setBody("")); server.start()
            val client = OkHttpClient()
            val job = launch { SnapshotStream(client, server.url("/").toString().removeSuffix("/")).packets().collect {} }
            assertNotNull(withContext(Dispatchers.IO) { server.takeRequest(3, TimeUnit.SECONDS) })
            job.cancelAndJoin()
            withTimeout(5000) { while (client.dispatcher.runningCallsCount() != 0) delay(10) }
        }
    }
}

package com.marketcapsule.app

import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.time.LocalDate
import org.junit.Assert.*
import org.junit.Test

class FiiDiiCashTest {
    private val now = Instant.parse("2026-11-07T04:30:00Z")
    private fun row(date: String) = JSONObject().put("date", date)
        .put("fetchedAt", "$date 15:05:01.123456+00").put("source", "NSE_FII_DII")
        .put("sourceUrl", "https://www.nseindia.com/api/fiidiiTradeReact")
        .put("fiiNetCrore", -100).put("diiNetCrore", 150).put("combinedNetCrore", 50)

    private fun fixture() = JSONObject("""{
        "mode":"READ_ONLY_FII_DII_PRODUCTION_READINESS_V1",
        "version":"CANONICAL_FII_DII_PRODUCTION_READINESS_V1",
        "source":"OFFICIAL_NSE","readOnly":true,"contextOnly":true,"mutatesData":false,
        "ok":true,"ready":true,"expectedMarketSessionDate":"2026-11-06",
        "latestStoredSessionDate":"2026-11-06","dailyHistoryState":"VERIFIED_STORED_EOD"
    }""").put("dailyHistory", JSONArray().put(row("2026-11-05")).put(row("2026-11-06")))

    private fun latest(json: JSONObject) = json.getJSONArray("dailyHistory").getJSONObject(1)
    private fun parse(json: JSONObject, status: Int = 200) = FiiDiiCashParser.parse(json.toString(), now, status)

    @Test fun latestStoredRowUsesTradingDateAndPostgresRetrievalTime() {
        val reading = parse(fixture())
        assertEquals(LocalDate.parse("2026-11-06"), reading.latest.date)
        assertEquals(Instant.parse("2026-11-06T15:05:01.123456Z"), reading.latest.fetchedAt)
        assertEquals(-100.0, reading.latest.fiiNetCrore, 0.0)
        assertEquals(50.0, reading.latest.combinedNetCrore, 0.0)
        assertTrue(reading.ready)
    }

    @Test fun verifiedHistoricalHistoryCanBeReadWhenCurrentReadinessIsPending() {
        val historical = fixture().put("ready", false).put("ok", false)
            .put("expectedMarketSessionDate", "2026-11-07")
        val reading = parse(historical, 503)
        assertFalse(reading.ready)
        assertEquals(LocalDate.parse("2026-11-06"), reading.latest.date)
        assertEquals(LocalDate.parse("2026-11-07"), reading.expectedSession)
        assertTrue(runCatching { parse(historical) }.isFailure)
        assertTrue(runCatching { parse(fixture(), 503) }.isFailure)
    }

    @Test fun offHoursResponseCannotBecomeCashFlowData() {
        val closed = JSONObject().put("error", "OUTSIDE_OPERATING_HOURS").put("ready", false)
        assertEquals("OUTSIDE_OPERATING_HOURS", runCatching { parse(closed, 503) }.exceptionOrNull()?.message)
        assertTrue(runCatching { parse(fixture().put("dailyHistoryState", "UNAVAILABLE")) }.isFailure)
    }

    @Test fun invalidAmountsAndNonofficialSourcesAreRejected() {
        for ((key, value) in listOf("combinedNetCrore" to 51, "diiNetCrore" to "150",
            "fiiNetCrore" to JSONObject.NULL, "source" to "UNKNOWN",
            "sourceUrl" to "https://www.nseindia.com.example/api/fiidiiTradeReact")) {
            val data = fixture()
            latest(data).put(key, value)
            assertTrue(key, runCatching { parse(data) }.isFailure)
        }
        val zero = fixture()
        latest(zero).put("fiiNetCrore", 0).put("combinedNetCrore", 150)
        assertEquals(0.0, parse(zero).latest.fiiNetCrore, 0.0)
    }

    @Test fun duplicateRowsAndLatestDateMismatchAreRejected() {
        val duplicate = fixture()
        duplicate.getJSONArray("dailyHistory").put(row("2026-11-06"))
        assertTrue(runCatching { parse(duplicate) }.isFailure)
        assertTrue(runCatching { parse(fixture().put("latestStoredSessionDate", "2026-11-07")) }.isFailure)
    }

    @Test fun badCalendarDatesAndRetrievalChronologyAreRejected() {
        val badDate = fixture()
        latest(badDate).put("date", "2026-11-31")
        assertTrue(runCatching { parse(badDate) }.isFailure)
        for (time in listOf("2026-11-05 15:05:00+00", "2026-11-07 05:00:00+00", "2026-11-06 15:05:00")) {
            val data = fixture()
            latest(data).put("fetchedAt", time)
            assertTrue(time, runCatching { parse(data) }.isFailure)
        }
    }

    @Test fun anOlderOrConflictingResponseCannotReplaceAcceptedData() {
        val saved = parse(fixture())
        assertTrue(saved.canReplace(saved))
        assertTrue(saved.copy(latest = saved.latest.copy(fetchedAt = saved.latest.fetchedAt.plusSeconds(1))).canReplace(saved))
        assertFalse(saved.copy(latest = saved.latest.copy(fetchedAt = saved.latest.fetchedAt.minusSeconds(1))).canReplace(saved))
        assertFalse(saved.copy(latest = saved.latest.copy(date = saved.latest.date.minusDays(1))).canReplace(saved))
        assertFalse(saved.copy(latest = saved.latest.copy(fiiNetCrore = -101.0)).canReplace(saved))
    }
}

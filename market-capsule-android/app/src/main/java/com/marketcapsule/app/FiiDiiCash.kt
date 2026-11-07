package com.marketcapsule.app

import org.json.JSONObject
import java.time.Instant
import java.time.LocalDate
import java.time.OffsetDateTime
import java.time.ZoneId
import kotlin.math.abs

internal data class FiiDiiCashRow(
    val date: LocalDate,
    val fetchedAt: Instant,
    val sourceUrl: String,
    val fiiNetCrore: Double,
    val diiNetCrore: Double,
    val combinedNetCrore: Double
)

internal data class FiiDiiCashRead(
    val latest: FiiDiiCashRow,
    val expectedSession: LocalDate,
    val ready: Boolean
) {
    fun canReplace(previous: FiiDiiCashRead?): Boolean = previous == null ||
        latest.date > previous.latest.date || (latest.date == previous.latest.date &&
            (latest.fetchedAt > previous.latest.fetchedAt || latest == previous.latest))
}

internal data class FetchedFiiDiiCash(val reading: FiiDiiCashRead, val raw: String)

internal object FiiDiiCashParser {
    private val india = ZoneId.of("Asia/Kolkata")
    private val officialSources = setOf("https://www.nseindia.com/api/fiidiiTradeNse",
        "https://www.nseindia.com/api/fiidiiTradeReact")

    fun parse(raw: String, now: Instant, httpStatus: Int? = null): FiiDiiCashRead {
        val root = JSONObject(raw)
        val runtimeError = root.optString("error")
        if (runtimeError in setOf("OUTSIDE_OPERATING_HOURS", "RUNTIME_STARTING")) error(runtimeError)
        require(root.optString("mode") == "READ_ONLY_FII_DII_PRODUCTION_READINESS_V1" &&
            root.optString("version") == "CANONICAL_FII_DII_PRODUCTION_READINESS_V1" &&
            root.optString("source") == "OFFICIAL_NSE" && root.opt("readOnly") == true &&
            root.opt("contextOnly") == true && root.opt("mutatesData") == false &&
            root.optString("dailyHistoryState") == "VERIFIED_STORED_EOD") { "FII_DII_UNAVAILABLE" }
        val ready = root.opt("ready") as? Boolean ?: error("FII_DII_INVALID")
        val expectedStatus = if (ready) 200 else 503
        require(root.opt("ok") == ready && (httpStatus == null || httpStatus == expectedStatus)) {
            "FII_DII_INVALID"
        }
        val today = now.atZone(india).toLocalDate()
        val expected = date(root, "expectedMarketSessionDate")
        val latestDate = date(root, "latestStoredSessionDate")
        require(expected <= today && latestDate <= today && (!ready || latestDate >= expected)) { "FII_DII_INVALID_DATE" }
        val history = root.optJSONArray("dailyHistory") ?: error("FII_DII_UNAVAILABLE")
        require(history.length() in 1..20) { "FII_DII_INVALID_HISTORY" }
        val rows = (0 until history.length()).map { position ->
            val row = history.getJSONObject(position)
            val tradeDate = date(row, "date")
            val sourceUrl = row.optString("sourceUrl")
            require(row.optString("source") == "NSE_FII_DII" && sourceUrl in officialSources) { "FII_DII_INVALID_SOURCE" }
            val fetchedAt = parseFetchedAt(row.optString("fetchedAt"))
            require(tradeDate <= today && fetchedAt.atZone(india).toLocalDate() >= tradeDate &&
                fetchedAt <= now.plusSeconds(5)) { "FII_DII_INVALID_DATE" }
            val fii = amount(row, "fiiNetCrore")
            val dii = amount(row, "diiNetCrore")
            val combined = amount(row, "combinedNetCrore")
            require(abs(fii + dii - combined) <= 0.02) { "FII_DII_INVALID_TOTAL" }
            FiiDiiCashRow(tradeDate, fetchedAt, sourceUrl, fii, dii, combined)
        }
        require(rows.zipWithNext().all { (first, second) -> first.date < second.date } &&
            rows.last().date == latestDate) { "FII_DII_INVALID_HISTORY" }
        return FiiDiiCashRead(rows.last(), expected, ready)
    }

    private fun date(row: JSONObject, key: String): LocalDate {
        val value = row.optString(key)
        return LocalDate.parse(value).also { require(it.toString() == value) { "FII_DII_INVALID_DATE" } }
    }

    private fun amount(row: JSONObject, key: String): Double = (row.opt(key) as? Number)?.toDouble()
        ?.takeIf { it.isFinite() } ?: error("FII_DII_INVALID_AMOUNT")

    private fun parseFetchedAt(value: String): Instant {
        // PostgreSQL TIMESTAMPTZ text can contain a space and a short offset such as +00.
        val iso = value.replaceFirst(' ', 'T')
        val normalized = if (Regex("[+-]\\d{2}$").containsMatchIn(iso)) "$iso:00" else iso
        return OffsetDateTime.parse(normalized).toInstant()
    }
}

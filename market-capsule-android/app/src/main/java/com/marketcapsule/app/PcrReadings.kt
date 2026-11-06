package com.marketcapsule.app

import org.json.JSONObject
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import kotlin.math.abs
import kotlin.math.max

internal const val PCR_SNAPSHOT_MAX_AGE_MS = 90_000L
internal data class PcrValue(
    val ratio: Double, val ceOi: Double, val peOi: Double,
    val sourceMinAt: String, val sourceMaxAt: String,
    val olderAtCheck: Int? = null, val anchorStrike: Double? = null,
    val fromStrike: Double? = null, val toStrike: Double? = null
)
internal data class PcrReading(
    val index: MarketIndex, val expiry: String, val checkedAt: String,
    val ageAtEnvelopeMs: Long, val expected: Int?, val freshOi: Int?,
    val full: PcrValue?, val band: PcrValue?, val reported: PcrValue?,
    val sourceReason: String
) {
    fun eligible(state: MarketUiState): Boolean {
        val current = state.current ?: return false
        val elapsed = state.receivedElapsedMs?.let {
            (state.currentElapsedMs - it).coerceAtLeast(0)
        } ?: return false
        // OI snapshots have a separate clock from spot/premium ticks. No saved
        // record, disconnected stream or different-index record can become current.
        return state.selected == index && current.connected &&
            current.pcrReadings[index] == this && state.deliveryAgeMs >= 0 &&
            ageAtEnvelopeMs + state.deliveryAgeMs + elapsed <= PCR_SNAPSHOT_MAX_AGE_MS
    }
}

/** Optional source projection: never substitutes band/reported OI for full PCR. */
internal object PcrReadingParser {
    private fun number(j: JSONObject, key: String): Double? =
        (j.opt(key) as? Number)?.toDouble()?.takeIf { it.isFinite() }
    private fun integer(j: JSONObject, key: String): Int? = number(j, key)?.takeIf {
        it >= 0 && it <= Int.MAX_VALUE && it % 1.0 == 0.0
    }?.toInt()
    private fun text(j: JSONObject, key: String): String? = (j.opt(key) as? String)?.takeIf { it.isNotBlank() }
    private fun instant(value: String?): Instant? = runCatching { value?.let(Instant::parse) }.getOrNull()
    private val india = ZoneId.of("Asia/Kolkata")
    private fun sameSession(at: Instant, date: LocalDate): Boolean =
        at.atZone(india).toLocalDate() == date && at >= date.atTime(9, 15).atZone(india).toInstant()
    private fun interval(j: JSONObject, checked: Instant, date: LocalDate, fresh: Boolean): Pair<String, String>? {
        val minText = text(j, "sourceMinAt") ?: return null
        val maxText = text(j, "sourceMaxAt") ?: return null
        val lo = instant(minText) ?: return null
        val hi = instant(maxText) ?: return null
        if (lo > hi || !sameSession(lo, date) || !sameSession(hi, date) || hi > checked.plusMillis(5000)) return null
        if (fresh && (Duration.between(lo, checked).toMillis() > 30_000 ||
                    Duration.between(lo, hi).toMillis() > 30_000)) return null
        return minText to maxText
    }
    private fun value(j: JSONObject, ratioKey: String, checked: Instant, date: LocalDate,
                      fresh: Boolean): PcrValue? {
        val ce = number(j, "ceTotal")?.takeIf { it > 0 && it <= 9_007_199_254_740_991.0 && it % 1.0 == 0.0 } ?: return null
        val pe = number(j, "peTotal")?.takeIf { it >= 0 && it <= 9_007_199_254_740_991.0 && it % 1.0 == 0.0 } ?: return null
        val ratio = number(j, ratioKey)?.takeIf { it >= 0 } ?: return null
        val calculated = pe / ce
        if (abs(ratio - calculated) > 1e-9 * max(1.0, abs(calculated))) return null
        val times = interval(j, checked, date, fresh) ?: return null
        return PcrValue(ratio, ce, pe, times.first, times.second)
    }

    fun parse(snapshot: JSONObject, server: Instant, connected: Boolean): Map<MarketIndex, PcrReading> {
        if (!connected) return emptyMap()
        val date = server.atZone(india).toLocalDate()
        if (snapshot.optString("tradeDate") != date.toString()) return emptyMap()
        val rows = snapshot.optJSONArray("indices") ?: return emptyMap()
        val result = mutableMapOf<MarketIndex, PcrReading>()
        for (i in 0 until rows.length()) {
            val row = rows.optJSONObject(i) ?: continue
            val index = MarketIndex.entries.find { it.name == row.optString("symbol") } ?: continue
            val expiry = text(row, "expiry") ?: continue
            if (!runCatching { LocalDate.parse(expiry).let { it.toString() == expiry && it >= date } }.getOrDefault(false)) continue
            val q = row.optJSONObject("pcrSnapshot") ?: continue
            if (q.optString("source") != "KITE_REST_FULL_EXPIRY_SNAPSHOT" ||
                q.optString("fetchState") != "OK" || q.optString("state") !in listOf("COMPLETE", "INCOMPLETE")) continue
            val checkedText = text(q, "checkedAt") ?: continue
            val checked = instant(checkedText) ?: continue
            val cycle = instant(text(q, "cycleStartedAt")) ?: continue
            val age = Duration.between(checked, server).toMillis()
            if (age !in 0..PCR_SNAPSHOT_MAX_AGE_MS || cycle > checked ||
                !sameSession(checked, date) || !sameSession(cycle, date)) continue
            val coverage = q.optJSONObject("coverage") ?: continue
            val expected = integer(coverage, "expected")?.takeIf { it >= 2 }
            val freshOi = integer(coverage, "freshOi")?.takeIf { expected != null && it <= expected }
            val noMissing = integer(coverage, "missing") == 0 && integer(coverage, "invalid") == 0
            val complete = expected != null && freshOi == expected && coverage.opt("complete") == true &&
                noMissing && integer(coverage, "stale") == 0 &&
                number(coverage, "sourceSkewMs")?.let { it in 0.0..30_000.0 } == true
            var full = if (q.optString("state") == "COMPLETE" && complete &&
                Duration.between(cycle, checked).toMillis() <= 60_000) value(q, "fullPcr", checked, date, true) else null

            var band = q.optJSONObject("bandPcr")?.let { b ->
                if (expected == null || expected < 30 || freshOi == null || freshOi < 30 ||
                    b.optString("state") != "COMPLETE" || integer(b, "halfWidth") != 7 ||
                    integer(b, "strikeCount") != 15 || integer(b, "expected") != 30 || integer(b, "freshOi") != 30) return@let null
                val raw = b.optJSONArray("strikes") ?: return@let null
                if (raw.length() != 15) return@let null
                val strikes = (0 until 15).map { n ->
                    (raw.opt(n) as? Number)?.toDouble()?.takeIf { it.isFinite() && it > 0 } ?: return@let null
                }
                if (strikes.zipWithNext().any { (a, z) -> a >= z } ||
                    number(b, "anchorStrike") != strikes[7] || number(b, "fromStrike") != strikes.first() ||
                    number(b, "toStrike") != strikes.last()) return@let null
                val anchor = instant(text(b, "anchorAt")) ?: return@let null
                if (!sameSession(anchor, date) || Duration.between(anchor, checked).toMillis() !in -5_000..30_000 ||
                    Duration.between(cycle, checked).toMillis() > 60_000) return@let null
                val measured = value(b, "value", checked, date, true) ?: return@let null
                val min = minOf(anchor, Instant.parse(measured.sourceMinAt))
                val max = maxOf(anchor, Instant.parse(measured.sourceMaxAt))
                if (Duration.between(min, max).toMillis() > 30_000) return@let null
                measured.copy(anchorStrike = strikes[7], fromStrike = strikes.first(), toStrike = strikes.last())
            }
            var reported = q.optJSONObject("reportedPcr")?.let { p ->
                if (p.optString("basis") != "LATEST_REPORTED_MIXED_TIMESTAMPS" ||
                    p.optString("symbol") != index.name || p.optString("expiry") != expiry ||
                    instant(text(p, "checkedAt")) != checked || expected == null ||
                    integer(p, "expected") != expected || integer(p, "reported") != expected || !noMissing) return@let null
                val older = integer(p, "olderThan30s")?.takeIf { it <= expected } ?: return@let null
                value(p, "value", checked, date, false)?.copy(olderAtCheck = older)
            }
            val conflict = (full != null && reported != null &&
                (full.ceOi != reported.ceOi || full.peOi != reported.peOi)) ||
                (full != null && band != null && (band.ceOi > full.ceOi || band.peOi > full.peOi))
            if (conflict) { full = null; band = null; reported = null }
            result[index] = PcrReading(index, expiry, checkedText, age, expected, freshOi, full, band, reported,
                if (conflict) "Source OI totals disagree; values withheld" else when (q.optString("reason")) {
                    "STALE_OI_TIMESTAMPS", "OI_TIME_SKEW" -> "Mixed or older OI source times"
                    "MISSING_QUOTES" -> "Some OI quotes are missing"
                    "CE_OI_ZERO" -> "CE OI is zero; ratio unavailable"
                    "INVALID_IDENTITY_OR_OI" -> "Source identity or OI conflict"
                    else -> "Waiting for a complete verified source snapshot"
                })
        }
        return result
    }
}

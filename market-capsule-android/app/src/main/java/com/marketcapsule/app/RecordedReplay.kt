package com.marketcapsule.app

import org.json.JSONObject
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

internal enum class ReplayIndex { NIFTY, SENSEX, BANKNIFTY }

internal data class RecordedSession(
    val index: ReplayIndex,
    val date: LocalDate,
    val firstMinute: Int,
    val lastMinute: Int,
) {
    fun window(start: Int = firstMinute) = ReplayWindow(this, start, minOf(start + 14, lastMinute))
}

internal data class ReplayWindow(val session: RecordedSession, val from: Int, val to: Int) {
    val previous get() = if (from > session.firstMinute) session.window(maxOf(from - 15, session.firstMinute)) else null
    val next get() = if (to < session.lastMinute) session.window(to + 1) else null
    val path get() = "/api/research/h1-replay?symbol=${session.index.name}&date=${session.date}" +
        "&from=${replayTime(from)}&to=${replayTime(to)}&scope=FULL&format=compact&canonical=pcr-provenance"
}

internal fun replayTime(minute: Int) = "%02d:%02d".format(java.util.Locale.ROOT, minute / 60, minute % 60)

internal enum class ReplayTable(val label: String, val field: String) {
    MARKET("Market", "market"), CHAIN("PCR & chain", "chain"), OPTIONS("Options", "options")
}

internal data class ReplayFrame(val time: Instant, val rows: Map<ReplayTable, List<Map<String, String>>>)
internal data class RecordedWindow(val window: ReplayWindow, val frames: List<ReplayFrame>)

internal object ReplayParser {
    private val zone = ZoneId.of("Asia/Kolkata")

    fun dates(raw: String): List<RecordedSession> {
        val root = successful(raw, "READ_ONLY_H1_RECORDED_DATE_INDEX_V1")
        val dates = root.getJSONArray("dates")
        return (0 until dates.length()).mapNotNull { i ->
            val row = dates.getJSONObject(i)
            val index = ReplayIndex.entries.firstOrNull { it.name == row.getString("symbol") } ?: return@mapNotNull null
            val date = LocalDate.parse(row.getString("tradeDate"))
            val first = Instant.parse(row.getString("firstMinute")).atZone(zone)
            val last = Instant.parse(row.getString("lastMinute")).atZone(zone)
            require(first.toLocalDate() == date && last.toLocalDate() == date && !last.isBefore(first))
            // The replay API covers the regular observation window.
            val start = maxOf(9 * 60 + 15, first.hour * 60 + first.minute)
            val end = last.hour * 60 + last.minute
            if (start > end) null else RecordedSession(index, date, start, end)
        }.distinct().sortedByDescending { it.date }.also { sessions ->
            require(sessions.distinctBy { it.index to it.date }.size == sessions.size)
        }
    }

    fun window(raw: String, expected: ReplayWindow): RecordedWindow {
        val root = successful(raw, "READ_ONLY_H1_3M_REPLAY_COMPACT_V1")
        val request = root.getJSONObject("request")
        require(request.opt("symbol") == expected.session.index.name &&
            request.opt("tradeDate") == expected.session.date.toString() &&
            request.opt("fromTime") == replayTime(expected.from) &&
            request.opt("toTime") == replayTime(expected.to) && request.opt("scope") == "FULL")
        val frames = sortedMapOf<Instant, MutableMap<ReplayTable, MutableList<Map<String, String>>>>()
        for (kind in ReplayTable.entries) {
            val table = root.getJSONObject(kind.field)
            val header = table.getJSONArray("columns")
            val columns = (0 until header.length()).map(header::getString)
            val rows = table.getJSONArray("rows")
            require(columns.distinct().size == columns.size)
            val symbolAt = columns.indexOf("symbol")
            val timeAt = columns.indexOf("minute_bucket")
            for (i in 0 until rows.length()) {
                val row = rows.getJSONArray(i)
                require(row.length() == columns.size && symbolAt >= 0 && timeAt >= 0)
                require(row.opt(symbolAt) == expected.session.index.name)
                val timestamp = Instant.parse(row.getString(timeAt))
                val local = timestamp.atZone(zone)
                require(local.toLocalDate() == expected.session.date &&
                    local.hour * 60 + local.minute in expected.from..expected.to)
                val values = columns.indices.associate { col ->
                    columns[col] to if (row.isNull(col)) "—" else row.get(col).toString()
                }
                frames.getOrPut(timestamp) { mutableMapOf() }.getOrPut(kind) { mutableListOf() }.add(values)
            }
        }
        return RecordedWindow(expected, frames.map { ReplayFrame(it.key, it.value) })
    }

    private fun successful(raw: String, mode: String): JSONObject {
        val json = JSONObject(raw)
        when (json.opt("error")) {
            "OUTSIDE_OPERATING_HOURS" -> error("REPLAY_OUTSIDE_HOURS")
            "RUNTIME_STARTING" -> error("REPLAY_STARTING")
        }
        require(json.opt("mode") == mode && json.opt("productionImpact") == "NONE" && json.opt("ok") == true) {
            "REPLAY_UNAVAILABLE"
        }
        return json
    }
}

package com.marketcapsule.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

class RecordedReplayTest {
    private val catalog = """
        {"ok":true,"mode":"READ_ONLY_H1_RECORDED_DATE_INDEX_V1","productionImpact":"NONE","dates":[
          {"symbol":"NIFTY","tradeDate":"2026-10-19","firstMinute":"2026-10-19T03:45:00Z","lastMinute":"2026-10-19T10:00:00Z"},
          {"symbol":"BANKNIFTY","tradeDate":"2026-10-20","firstMinute":"2026-10-20T03:45:00Z","lastMinute":"2026-10-20T03:58:00Z"}
        ]}
    """.trimIndent()

    private val response = """
        {"ok":true,"mode":"READ_ONLY_H1_3M_REPLAY_COMPACT_V1","productionImpact":"NONE",
         "request":{"symbol":"NIFTY","tradeDate":"2026-10-19","fromTime":"09:15","toTime":"09:29","scope":"FULL"},
         "market":{"columns":["minute_bucket","spot_ltp","symbol"],"rows":[
           ["2026-10-19T03:51:00Z",24002.0,"NIFTY"],["2026-10-19T03:45:00Z",null,"NIFTY"]]},
         "chain":{"columns":[],"rows":[]},
         "options":{"columns":["symbol","minute_bucket","expiry","strike","option_type","ltp"],"rows":[
           ["NIFTY","2026-10-19T03:51:00Z","2026-10-20",24000,"CE","42.5"]]}
        }
    """.trimIndent()

    @Test fun catalogExposesEachRecordedIndexAndTraversesWithoutOverlaps() {
        val sessions = ReplayParser.dates(catalog)
        assertEquals(listOf(ReplayIndex.BANKNIFTY, ReplayIndex.NIFTY), sessions.map { it.index })
        val first = sessions.last().window()
        val windows = generateSequence(first) { it.next }.toList()
        assertEquals((555..930).toList(), windows.flatMap { (it.from..it.to).toList() })
        assertEquals(first, windows[1].previous)
        assertTrue(first.path.contains("scope=FULL"))
    }

    @Test fun preservesActualTimesAndNullsAndRejectsWrongRowsOrRequest() {
        val window = ReplayParser.dates(catalog).last().window()
        val frames = ReplayParser.window(response, window).frames
        assertEquals(listOf("2026-10-19T03:45:00Z", "2026-10-19T03:51:00Z").map(Instant::parse), frames.map { it.time })
        assertEquals("—", frames.first().rows.getValue(ReplayTable.MARKET).single()["spot_ltp"])
        assertEquals("42.5", frames.last().rows.getValue(ReplayTable.OPTIONS).single()["ltp"])
        assertThrows(IllegalArgumentException::class.java) {
            ReplayParser.window(response.replace("24002.0,\"NIFTY\"", "24002.0,\"SENSEX\""), window)
        }
        assertThrows(IllegalArgumentException::class.java) {
            ReplayParser.window(response.replace("09:29", "09:30"), window)
        }
    }

    @Test fun closedRuntimeIsAnExplicitUnavailableState() {
        val result = assertThrows(IllegalStateException::class.java) {
            ReplayParser.dates("""{"error":"OUTSIDE_OPERATING_HOURS"}""")
        }
        assertEquals("REPLAY_OUTSIDE_HOURS", result.message)
    }
}

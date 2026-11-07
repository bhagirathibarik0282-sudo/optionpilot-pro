package com.marketcapsule.app

import java.time.Instant
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class StrikeOiTest {
    private val time = "2026-11-06T04:30:00Z"
    private val now = Instant.parse(time).toEpochMilli()
    private val expiry = "2026-11-09"
    private fun quote(strike: Int, token: Int, oi: Any) = JSONObject()
        .put("identity", JSONObject().put("symbol", "NIFTY").put("role", "OPTION")
            .put("expiry", expiry).put("side", "CE").put("strike", strike).put("token", token))
        .put("state", "LIVE").put("oi", oi).put("observedAt", time).put("receivedAt", time)
    private fun read(rows: JSONArray) = StrikeLadderParser.parse(JSONObject().put("runtimeId", "fixture")
        .put("tradeDate", "2026-11-06").put("rows", rows).toString(), MarketIndex.NIFTY, expiry, now, 0)
    private fun state(elapsed: Long = 0): MarketUiState {
        val quote = Quote(MarketIndex.NIFTY, 24000.0, 0.0, time, time, 0, "LIVE", null, null, null, null, null, null)
        return MarketUiState(current = MarketSnapshot("fixture", 1, time, true, "OPEN", mapOf(MarketIndex.NIFTY to quote)),
            receivedElapsedMs = elapsed, currentElapsedMs = elapsed)
    }
    private fun bandRows(): JSONArray = JSONArray().apply {
        listOf(100, 300, 0, 300, 200, 80, 50).forEachIndexed { index, oi ->
            put(quote(23850 + index * 50, index + 1, oi))
        }
    }

    @Test fun exactBandRanksPositiveOiAndKeepsEveryTiedWall() {
        val read = read(bandRows())
        assertNull(read.rows.first().ce?.price)
        val ranks = read.rankOi(state(), read.rows, 3) { it.ce }
        assertEquals(7, ranks.values.size)
        assertEquals(1, ranks.ranks[23900.0])
        assertEquals(1, ranks.ranks[24000.0])
        assertEquals(3, ranks.ranks[24050.0])
        assertEquals(0L, ranks.values[23950.0])
        assertNull(ranks.ranks[23950.0])
        assertEquals(listOf(23900.0, 24000.0), ranks.walls)
    }

    @Test fun incompleteBandRetainsAvailableRanksAndWithholdsWall() {
        val rows = bandRows()
        rows.getJSONObject(1).put("oi", JSONObject.NULL)
        val read = read(rows)
        val ranks = read.rankOi(state(), read.rows, 3) { it.ce }
        assertEquals(6, ranks.values.size)
        assertEquals(1, ranks.ranks[24000.0])
        assertTrue(ranks.walls.isEmpty())
        assertTrue(read.rankOi(state(), read.rows, 5) { it.ce }.walls.isEmpty())
    }

    @Test fun invalidOiDoesNotRemoveValidPremiums() {
        for (oi in listOf(-1, 1.5, "100", JSONObject.NULL)) {
            val read = read(JSONArray().put(quote(24000, 1, oi).put("price", 110)))
            assertNull(read.rows.single().ce?.oi)
            assertEquals(110.0, read.rows.single().ce!!.price!!, 0.0)
        }
    }

    @Test fun duplicateTokensAndMissingTokenCannotBecomeRankedOi() {
        val missing = quote(24050, 2, 100)
        missing.getJSONObject("identity").remove("token")
        val read = read(JSONArray().put(quote(23950, 1, 300)).put(quote(24000, 1, 200)).put(missing))
        assertTrue(read.rankOi(state(), read.rows, 3) { it.ce }.values.isEmpty())
    }

    @Test fun validOiExpiresEvenWhenTheMainSnapshotRemainsFresh() {
        val read = read(bandRows())
        assertTrue(read.rankOi(state(30001), read.rows, 3) { it.ce }.values.isEmpty())
        assertTrue(read.rankOi(state().copy(selected = MarketIndex.SENSEX), read.rows, 3) { it.ce }.values.isEmpty())
    }

    @Test fun individuallyFreshButUnsynchronizedQuotesWithholdTheWall() {
        val rows = bandRows()
        rows.getJSONObject(0).put("observedAt", "2026-11-06T04:29:31Z")
        rows.getJSONObject(1).put("observedAt", "2026-11-06T04:30:05Z")
        val read = read(rows)
        val ranks = read.rankOi(state(), read.rows, 3) { it.ce }
        assertEquals(7, ranks.values.size)
        assertTrue(ranks.walls.isEmpty())
    }
}

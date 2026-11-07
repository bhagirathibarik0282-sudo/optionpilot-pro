package com.marketcapsule.app

import org.json.JSONObject
import java.time.Instant
import org.junit.Assert.*
import org.junit.Test

class MarketReferencesTest {
    private val time = "2026-11-05T04:00:00Z"
    private val server = Instant.parse(time)
    private fun fixture() = JSONObject("""{
      "runtimeId":"fixture","sequence":1,"tradeDate":"2026-11-05","indices":[{
        "symbol":"NIFTY","futuresBasis":50,
        "spot":{"identity":{"symbol":"NIFTY","role":"SPOT","token":1001},
          "state":"LIVE","price":24000,"pdc":23900,"dayOpen":23980,"dayHigh":24100,"dayLow":23950,
          "observedAt":"2026-11-05T04:00:00Z","receivedAt":"2026-11-05T04:00:00Z"},
        "future":{"identity":{"symbol":"NIFTY","role":"FUTURE","token":1002,
          "expiry":"2026-11-26","label":"NIFTYNOVFUT"},"state":"LIVE","price":24050,
          "observedAt":"2026-11-05T04:00:00Z","receivedAt":"2026-11-05T04:00:00Z"}
      }]}""")
    private fun row(s: JSONObject) = s.getJSONArray("indices").getJSONObject(0)
    private fun read(s: JSONObject = fixture()) = MarketReferenceParser.parse(s, server, true)[MarketIndex.NIFTY]!!
    private fun state(r: MarketReference, elapsed: Long = 0, delivery: Long = 0) = MarketUiState(
        current = MarketSnapshot("fixture",1,time,true,"CONNECTED",emptyMap(),references = mapOf(MarketIndex.NIFTY to r)),
        receivedElapsedMs = 0,currentElapsedMs = elapsed,deliveryAgeMs = delivery)

    @Test fun brokerReferencesAndExactFutureIdentityAreRetained() {
        val r = read()
        assertEquals(23900.0,r.spot!!.previousClose!!,0.0)
        assertEquals(23980.0,r.spot.dayOpen!!,0.0)
        assertEquals(24100.0,r.spot.dayHigh!!,0.0)
        assertEquals(23950.0,r.spot.dayLow!!,0.0)
        assertEquals("2026-11-26",r.future!!.expiry)
        assertEquals("NIFTYNOVFUT",r.future.contract)
        assertEquals(1002L,r.future.token)
        assertEquals(50.0,r.basis(state(r))!!,0.0)
    }
    @Test fun missingOrInvalidReferenceFieldsAreNotCalculatedOrZeroFilled() {
        val s = fixture();val spot = row(s).getJSONObject("spot")
        spot.remove("pdc");spot.put("dayOpen","23980");spot.put("dayHigh",0);spot.put("dayLow",JSONObject.NULL)
        val r = read(s)
        assertNotNull(r.spot)
        assertNull(r.spot!!.previousClose);assertNull(r.spot.dayOpen)
        assertNull(r.spot.dayHigh);assertNull(r.spot.dayLow)
    }
    @Test fun contradictoryOhlcIsWithheldWithoutErasingThePriceOrPreviousClose() {
        val s = fixture();row(s).getJSONObject("spot").put("dayHigh",23900)
        val r = read(s)
        assertEquals(24000.0,r.spot!!.price,0.0)
        assertEquals(23900.0,r.spot.previousClose!!,0.0)
        assertNull(r.spot.dayOpen);assertNull(r.spot.dayHigh);assertNull(r.spot.dayLow)
    }
    @Test fun foreignFutureIdentityOnlyWithholdsTheFutureAndBasis() {
        for ((k,v) in listOf("symbol" to "SENSEX","role" to "OPTION","token" to 0,"label" to "")) {
            val s = fixture();row(s).getJSONObject("future").getJSONObject("identity").put(k,v)
            val r = read(s);assertNotNull(r.spot);assertNull(r.future);assertNull(r.verifiedBasis)
        }
    }
    @Test fun futureExpiryMustBeRealCanonicalAndNotPast() {
        for (expiry in listOf("2026-11-04","2026-11-31","2026-1-9")) {
            val s = fixture();row(s).getJSONObject("future").getJSONObject("identity").put("expiry",expiry)
            assertNull(read(s).future)
        }
    }
    @Test fun wrongTradingDateDisconnectedAndDuplicateIndexFailClosed() {
        val s = fixture().put("tradeDate","2026-11-04")
        assertTrue(MarketReferenceParser.parse(s,server,true).isEmpty())
        assertTrue(MarketReferenceParser.parse(fixture(),server,false).isEmpty())
        val duplicate = fixture();duplicate.getJSONArray("indices").put(row(duplicate))
        assertTrue(MarketReferenceParser.parse(duplicate,server,true).isEmpty())
    }
    @Test fun staleFutureAndImpossibleReceiptNeverProduceBasis() {
        for ((key,value) in listOf("observedAt" to "2026-11-05T03:59:29Z",
            "receivedAt" to "2026-11-05T04:00:01Z","observedAt" to "2026-11-05T04:00:06Z")) {
            val s = fixture();row(s).getJSONObject("future").put(key,value)
            val r = read(s);assertNotNull(r.spot);assertNull(r.future);assertNull(r.verifiedBasis)
        }
    }
    @Test fun preopenAndPriorSessionQuotesAreNotCurrentSessionReferences() {
        val early = fixture();row(early).getJSONObject("spot").put("observedAt","2026-11-05T03:44:59Z")
        row(early).getJSONObject("spot").put("receivedAt","2026-11-05T03:45:01Z")
        val justOpened=Instant.parse("2026-11-05T03:45:10Z")
        assertNull(MarketReferenceParser.parse(early,justOpened,true)[MarketIndex.NIFTY]?.spot)
        val prior = fixture();row(prior).getJSONObject("spot").put("observedAt","2026-11-04T04:00:00Z")
        assertNull(read(prior).spot)
    }
    @Test fun zeroBasisIsValidButMissingOrConflictingBasisIsNotReconstructed() {
        val flat = fixture();row(flat).put("futuresBasis",0).getJSONObject("future").put("price",24000)
        assertEquals(0.0,read(flat).verifiedBasis!!,0.0)
        val missing = fixture();row(missing).remove("futuresBasis");assertNull(read(missing).verifiedBasis)
        val conflict = fixture();row(conflict).put("futuresBasis",51);assertNull(read(conflict).verifiedBasis)
    }
    @Test fun unsynchronizedFreshLegsCannotProduceBasis() {
        val s = fixture();row(s).getJSONObject("future").put("observedAt","2026-11-05T03:59:54Z")
        val r = read(s);assertNotNull(r.future);assertNull(r.verifiedBasis)
    }
    @Test fun deliveryElapsedIndexAndSavedStateCannotPromoteReferences() {
        val r = read();val live = state(r)
        assertTrue(r.eligible(live,r.spot))
        for (s in listOf(state(r,elapsed=5001),state(r,delivery=30001),
            live.copy(selected=MarketIndex.SENSEX),live.copy(current=null,saved=live.current),
            live.copy(current=live.current!!.copy(connected=false)))) {
            assertFalse(r.eligible(s,r.spot));assertNull(r.basis(s))
        }
        val older = r.copy(future=r.future!!.copy(ageMs=29000))
        assertTrue(older.eligible(state(older,delivery=2000),older.spot))
        assertFalse(older.eligible(state(older,delivery=2000),older.future))
        assertNull(older.basis(state(older,delivery=2000)))
    }
    @Test fun malformedOptionalFutureCannotEraseAValidCoreSpotQuote() {
        val s = fixture();row(s).getJSONObject("future").put("observedAt","+999999999-01-01T00:00:00Z")
        val root = JSONObject().put("source","KITE_WEBSOCKET_FULL").put("serverTime",time)
            .put("connected",true).put("connectionState","CONNECTED").put("snapshot",s)
        val parsed = SnapshotParser.parse(root.toString())
        assertEquals(24000.0,parsed.quotes[MarketIndex.NIFTY]!!.price!!,0.0)
        assertNotNull(parsed.references[MarketIndex.NIFTY]!!.spot)
        assertNull(parsed.references[MarketIndex.NIFTY]!!.future)
    }
}

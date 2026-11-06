package com.marketcapsule.app

import org.json.JSONObject
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

internal data class PremiumLeg(val price: Double, val changePct: Double?, val ageMs: Long, val observedAt: String) {
    fun eligible(state: MarketUiState): Boolean {
        val elapsed = state.receivedElapsedMs?.let { (state.currentElapsedMs - it).coerceAtLeast(0) } ?: return false
        return state.status == ReadingStatus.RECENT_SNAPSHOT && ageMs + elapsed + state.deliveryAgeMs <= QUOTE_MAX_AGE_MS
    }
}
internal data class ExpiryPair(val expiry: String, val strike: Double, val ce: PremiumLeg?, val pe: PremiumLeg?)

/** Optional panel: malformed ladder data cannot remove a valid spot reading. */
internal object ExpiryLadderParser {
    private fun finite(j: JSONObject, key: String): Double? = (j.opt(key) as? Number)?.toDouble()?.takeIf { it.isFinite() }
    fun parse(snapshot: JSONObject, server: Instant, connected: Boolean): Map<MarketIndex, List<ExpiryPair>> {
        if (!connected) return emptyMap()
        val groups = snapshot.optJSONArray("atmExpiryLadder") ?: return emptyMap()
        val result = mutableMapOf<MarketIndex, List<ExpiryPair>>()
        val seen = mutableSetOf<MarketIndex>()
        val invalid = mutableSetOf<MarketIndex>()
        val date = server.atZone(ZoneId.of("Asia/Kolkata")).toLocalDate()
        for (g in 0 until groups.length()) {
            val group = groups.optJSONObject(g) ?: continue
            val symbol = MarketIndex.entries.find { it.name == group.optString("symbol") } ?: continue
            if (!seen.add(symbol)) { invalid.add(symbol); continue }
            val rows = group.optJSONArray("rows") ?: continue
            // Current contract supplies at most three weekly/monthly rows per primary index.
            if (rows.length() > 3) continue
            val pairs = mutableListOf<ExpiryPair>()
            val dates = mutableSetOf<String>()
            var duplicate = false
            for (r in 0 until rows.length()) {
                val row = rows.optJSONObject(r) ?: continue
                val expiry = row.opt("expiry") as? String ?: continue
                if (!dates.add(expiry)) { duplicate = true; break }
                if (!runCatching { LocalDate.parse(expiry).let { it.toString() == expiry && it >= date } }.getOrDefault(false)) continue
                val strike = finite(row, "strike")?.takeIf { it > 0 } ?: continue
                fun leg(side: String): PremiumLeg? {
                    val q = row.optJSONObject(side.lowercase()) ?: return null
                    val id = q.optJSONObject("identity") ?: return null
                    if (q.optString("state") != "LIVE" || id.optString("symbol") != symbol.name ||
                        id.optString("role") != "OPTION" || id.optString("side") != side ||
                        id.optString("expiry") != expiry || finite(id, "strike") != strike) return null
                    val observed = q.opt("observedAt") as? String ?: return null
                    val received = q.opt("receivedAt") as? String ?: return null
                    val age = runCatching { Duration.between(Instant.parse(observed), server).toMillis() }.getOrNull() ?: return null
                    val receiptAge = runCatching { Duration.between(Instant.parse(received), server).toMillis() }.getOrNull() ?: return null
                    if (age !in -5_000..QUOTE_MAX_AGE_MS || receiptAge !in 0..QUOTE_MAX_AGE_MS || age + 5_000 < receiptAge) return null
                    val price = finite(q, "price")?.takeIf { it > 0 } ?: return null
                    return PremiumLeg(price, finite(q, "changePct"), maxOf(0, age, receiptAge), observed)
                }
                pairs.add(ExpiryPair(expiry, strike, leg("CE"), leg("PE")))
            }
            if (!duplicate) result[symbol] = pairs.sortedBy { it.expiry }
        }
        invalid.forEach { result.remove(it) }
        return result
    }
}

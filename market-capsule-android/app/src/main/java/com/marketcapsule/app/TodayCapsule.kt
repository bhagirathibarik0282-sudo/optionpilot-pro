package com.marketcapsule.app

/** A projection of validated observations, never an explanation of market cause. */
internal data class TodayCapsule(
    val index: MarketIndex,
    val dayChangePct: Double?,
    val spotObservedAt: String?,
    val pcr: PcrReading?,
    val watchNext: List<String>
) {
    val hasObservation: Boolean get() = spotObservedAt != null ||
        pcr?.let { it.full != null || it.band != null || it.reported != null } == true
}

internal object TodayCapsuleComposer {
    fun compose(state: MarketUiState): TodayCapsule {
        // Use the existing per-family eligibility rules; do not promote saved
        // values or make valid OI depend on the faster spot/envelope clock.
        val spot = state.quote?.takeIf {
            state.status == ReadingStatus.RECENT_SNAPSHOT &&
                it.index == state.selected && it.price?.let { p -> p.isFinite() && p > 0 } == true
        }
        val change = spot?.changePct?.takeIf { it.isFinite() }
        val pcr = state.current?.pcrReadings?.get(state.selected)?.takeIf { it.eligible(state) }
        val priceWatch = when {
            change == null -> "Wait for a fresh day-change reading before comparing with previous close."
            change > 0 -> "Watch whether the next fresh reading remains above broker previous close."
            change < 0 -> "Watch whether the next fresh reading remains below broker previous close."
            else -> "Watch whether the next fresh reading moves above or below broker previous close."
        }
        val optionsWatch = when {
            pcr?.full != null -> "Compare the next full PCR snapshot at the same expiry; PCR alone is not a trading signal."
            pcr?.band != null -> "Check full-inventory coverage separately; ATM ±7 PCR describes only its strike band."
            pcr?.reported != null -> "Wait for verified full PCR; latest-reported OI has mixed source times."
            else -> "Check exact-expiry CE/PE readings in Live Desk when fresh data is available."
        }
        return TodayCapsule(state.selected, change, spot?.observedAt, pcr,
            listOf(priceWatch, optionsWatch))
    }
}

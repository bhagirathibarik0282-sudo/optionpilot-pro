package com.marketcapsule.app

internal enum class ParticipationKind(val title: String) {
    STOCK("Tracked stocks"),
    SECTOR("Sector & broad-market indices")
}

internal data class ParticipationReading(
    val kind: ParticipationKind,
    val token: Long,
    val label: String,
    val quote: ReferenceQuote,
    val changePct: Double
)

internal data class ParticipationSnapshot(
    val returnedCount: Int,
    val rows: List<ParticipationReading>
) {
    fun eligible(state: MarketUiState): List<ParticipationReading> {
        val current = state.current ?: return emptyList()
        if (!current.connected || current.participation != this) return emptyList()
        return rows.filter { it.quote.isFresh(state) }
    }

    fun movers(state: MarketUiState, kind: ParticipationKind, rising: Boolean): List<ParticipationReading> =
        eligible(state).filter { it.kind == kind && (if (rising) it.changePct > 0 else it.changePct < 0) }
            .sortedWith(compareBy<ParticipationReading> { if (rising) -it.changePct else it.changePct }
                .thenBy { it.label }.thenBy { it.token })
            .take(3)
}

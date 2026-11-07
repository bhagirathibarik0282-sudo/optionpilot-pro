package com.marketcapsule.app

internal data class ConstituentWeight(val symbol: String, val name: String, val hundredths: Int)

/** Dated factsheet figures. Each table contains the ten published leading constituents. */
internal enum class IndexWeightSnapshot(
    val label: String,
    val asOf: String,
    val constituentCount: Int,
    val sourceUrl: String,
    val rows: List<ConstituentWeight>
) {
    NIFTY_50(
        "NIFTY 50", "2026-10-30", 50,
        "https://www.niftyindices.com/Factsheet/ind_nifty50.pdf",
        listOf(
            ConstituentWeight("HDFCBANK", "HDFC Bank", 995),
            ConstituentWeight("ICICIBANK", "ICICI Bank", 939),
            ConstituentWeight("RELIANCE", "Reliance Industries", 730),
            ConstituentWeight("BHARTIARTL", "Bharti Airtel", 563),
            ConstituentWeight("LT", "Larsen & Toubro", 425),
            ConstituentWeight("INFY", "Infosys", 392),
            ConstituentWeight("SBIN", "State Bank of India", 373),
            ConstituentWeight("AXISBANK", "Axis Bank", 328),
            ConstituentWeight("KOTAKBANK", "Kotak Mahindra Bank", 319),
            ConstituentWeight("BAJFINANCE", "Bajaj Finance", 240)
        )
    ),
    BANK_NIFTY(
        "BANKNIFTY", "2026-10-30", 14,
        "https://www.niftyindices.com/Factsheet/ind_nifty_bank.pdf",
        listOf(
            ConstituentWeight("HDFCBANK", "HDFC Bank", 1818),
            ConstituentWeight("ICICIBANK", "ICICI Bank", 1499),
            ConstituentWeight("KOTAKBANK", "Kotak Mahindra Bank", 1128),
            ConstituentWeight("AXISBANK", "Axis Bank", 997),
            ConstituentWeight("SBIN", "State Bank of India", 994),
            ConstituentWeight("FEDERALBNK", "Federal Bank", 702),
            ConstituentWeight("INDUSINDBK", "IndusInd Bank", 462),
            ConstituentWeight("AUBANK", "AU Small Finance Bank", 414),
            ConstituentWeight("IDFCFIRSTB", "IDFC First Bank", 401),
            ConstituentWeight("BANKBARODA", "Bank of Baroda", 371)
        )
    );

    val coveredPercent: Double get() = rows.sumOf { it.hundredths } / 100.0
}


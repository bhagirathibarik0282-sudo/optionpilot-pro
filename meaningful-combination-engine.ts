import { dbQuerySafe } from "./db.js";
import { deriveTemporalEvidenceState } from "./temporal-evidence-fusion.js";

export type CombinationState = "SUPPORTIVE" | "NEUTRAL" | "CONFLICTING" | "WARNING" | "UNAVAILABLE";
export type EvidenceBias = "BULLISH" | "BEARISH" | "MIXED" | "NONE" | "UNKNOWN";

export type CombinationId =
  | "COMB-01"
  | "COMB-02"
  | "COMB-03"
  | "COMB-04"
  | "COMB-05"
  | "COMB-06"
  | "COMB-07"
  | "COMB-08";

export interface MeaningfulCombinationResult {
  id: CombinationId;
  name: string;
  state: CombinationState;
  bias: EvidenceBias;
  reasons: string[];
  inputsUsed: string[];
  missingInputs: string[];
  semantics: "FORWARD_TESTING_EVIDENCE_ONLY";
}

export interface MeaningfulCombinationSnapshot {
  symbol: "NIFTY" | "BANKNIFTY" | "SENSEX";
  minuteBucket: string | null;
  combinations: MeaningfulCombinationResult[];
  availableCount: number;
  warningCount: number;
  conflictCount: number;
  ruleVersion: "TEF_COMBINATION_V1";
  affectsVerdict: false;
  affectsTelegram: false;
  affectsExecution: false;
}

type MarketRow = {
  minute_bucket: string | Date;
  spot_ltp: number | null;
  vwap: number | null;
  pdh: number | null;
  pdl: number | null;
  future_ltp: number | null;
  future_oi: number | null;
  india_vix: number | null;
};

type OptionRow = {
  expiry: string | Date;
  expiry_bucket: string | null;
  strike: number;
  option_type: "CE" | "PE";
  atm_offset: number | null;
  ltp: number | null;
  oi: number | null;
  iv: number | null;
  delta: number | null;
  gamma: number | null;
  vega: number | null;
  theta: number | null;
  intrinsic: number | null;
  extrinsic: number | null;
  pdh: number | null;
  pdl: number | null;
  validation_status: string | null;
};

type ChainRow = {
  expiry: string | Date;
  expiry_bucket: string | null;
  full_chain_oi_pcr: number | null;
  band7_oi_pcr: number | null;
  volume_pcr: number | null;
  call_wall_strike: number | null;
  call_wall_strength: number | null;
  put_wall_strike: number | null;
  put_wall_strength: number | null;
  atm_iv: number | null;
  straddle_ltp: number | null;
};

const result = (
  id: CombinationId,
  name: string,
  state: CombinationState,
  bias: EvidenceBias,
  reasons: string[],
  inputsUsed: string[],
  missingInputs: string[] = [],
): MeaningfulCombinationResult => ({ id, name, state, bias, reasons, inputsUsed, missingInputs, semantics: "FORWARD_TESTING_EVIDENCE_ONLY" });

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function atmPair(options: OptionRow[]): { ce: OptionRow | null; pe: OptionRow | null } {
  const atm = options.filter((o) => o.atm_offset === 0);
  return { ce: atm.find((o) => o.option_type === "CE") ?? null, pe: atm.find((o) => o.option_type === "PE") ?? null };
}

function comb01(m: MarketRow | null): MeaningfulCombinationResult {
  const id: CombinationId = "COMB-01";
  const name = "Spot + Futures + VWAP Directional Participation";
  if (!m || !finite(m.spot_ltp) || !finite(m.future_ltp) || !finite(m.vwap)) {
    return result(id, name, "UNAVAILABLE", "UNKNOWN", ["Spot/futures/VWAP inputs are incomplete."], [], ["spot_ltp", "future_ltp", "vwap"]);
  }
  const spotAbove = m.spot_ltp > m.vwap;
  const basisUp = m.future_ltp >= m.spot_ltp;
  if (spotAbove && basisUp) return result(id, name, "SUPPORTIVE", "BULLISH", ["Spot is above VWAP and futures are not discounting spot."], ["spot_ltp", "future_ltp", "vwap"]);
  if (!spotAbove && !basisUp) return result(id, name, "SUPPORTIVE", "BEARISH", ["Spot is below VWAP and futures trade below spot."], ["spot_ltp", "future_ltp", "vwap"]);
  return result(id, name, "CONFLICTING", "MIXED", ["Spot/VWAP and futures basis do not align cleanly."], ["spot_ltp", "future_ltp", "vwap"]);
}

function comb02(options: OptionRow[]): MeaningfulCombinationResult {
  const id: CombinationId = "COMB-02";
  const name = "Premium + Intrinsic + Delta + Gamma Directional Premium Confirmation";
  const { ce, pe } = atmPair(options);
  if (!ce || !pe || !finite(ce.ltp) || !finite(pe.ltp) || !finite(ce.delta) || !finite(pe.delta)) {
    return result(id, name, "UNAVAILABLE", "UNKNOWN", ["ATM CE/PE premium and delta are required."], [], ["ATM CE/PE ltp", "ATM CE/PE delta"]);
  }
  const ceQuality = finite(ce.intrinsic) && finite(ce.gamma) && ce.delta > 0.35 && ce.gamma > 0;
  const peQuality = finite(pe.intrinsic) && finite(pe.gamma) && pe.delta < -0.35 && pe.gamma > 0;
  if (ceQuality && ce.ltp > pe.ltp * 1.08) return result(id, name, "SUPPORTIVE", "BULLISH", ["ATM CE premium dominates while CE delta/gamma are directionally usable."], ["premium", "intrinsic", "delta", "gamma"]);
  if (peQuality && pe.ltp > ce.ltp * 1.08) return result(id, name, "SUPPORTIVE", "BEARISH", ["ATM PE premium dominates while PE delta/gamma are directionally usable."], ["premium", "intrinsic", "delta", "gamma"]);
  return result(id, name, "NEUTRAL", "NONE", ["ATM premium/Greek evidence does not show clean directional dominance."], ["premium", "intrinsic", "delta", "gamma"]);
}

function comb03(options: OptionRow[], chain: ChainRow | null): MeaningfulCombinationResult {
  const id: CombinationId = "COMB-03";
  const name = "IV + Vega + Theta + Expiry Volatility/Decay Quality";
  const { ce, pe } = atmPair(options);
  if (!ce || !pe || !finite(ce.theta) || !finite(pe.theta) || !finite(ce.vega) || !finite(pe.vega)) {
    return result(id, name, "UNAVAILABLE", "UNKNOWN", ["ATM theta/vega inputs are incomplete."], [], ["ATM theta", "ATM vega"]);
  }
  const thetaBurden = Math.abs(ce.theta) + Math.abs(pe.theta);
  const vegaCapacity = Math.abs(ce.vega) + Math.abs(pe.vega);
  if (finite(chain?.atm_iv) && thetaBurden > vegaCapacity * 3) return result(id, name, "WARNING", "NONE", ["Combined ATM theta burden is high relative to vega sensitivity; option-buyer decay risk is elevated."], ["atm_iv", "theta", "vega"]);
  return result(id, name, "NEUTRAL", "NONE", ["Volatility/decay inputs are available but not used as a direction signal."], ["atm_iv", "theta", "vega"]);
}

function comb04(m: MarketRow | null, chain: ChainRow | null): MeaningfulCombinationResult {
  const id: CombinationId = "COMB-04";
  const name = "±7 OI + Wall Positioning Behaviour";
  if (!m || !chain || !finite(m.spot_ltp) || !finite(chain.call_wall_strike) || !finite(chain.put_wall_strike)) {
    return result(id, name, "UNAVAILABLE", "UNKNOWN", ["Spot and both wall strikes are required."], [], ["spot_ltp", "call_wall_strike", "put_wall_strike"]);
  }
  const callDist = chain.call_wall_strike - m.spot_ltp;
  const putDist = m.spot_ltp - chain.put_wall_strike;
  if (callDist < 0 && putDist > 0) return result(id, name, "WARNING", "BULLISH", ["Spot is above the stored call-wall strike; breakout/reclaim context needs confirmation."], ["spot", "walls", "wall_strength"]);
  if (putDist < 0 && callDist > 0) return result(id, name, "WARNING", "BEARISH", ["Spot is below the stored put-wall strike; breakdown/reclaim context needs confirmation."], ["spot", "walls", "wall_strength"]);
  return result(id, name, "NEUTRAL", "NONE", ["Spot remains between stored call/put wall strikes; walls are context, not hard support/resistance."], ["spot", "walls", "wall_strength"]);
}

function comb05(chain: ChainRow | null): MeaningfulCombinationResult {
  const id: CombinationId = "COMB-05";
  const name = "Full-chain PCR + ±7 PCR + Volume PCR Positioning Change";
  if (!chain || !finite(chain.full_chain_oi_pcr) || !finite(chain.band7_oi_pcr) || !finite(chain.volume_pcr)) {
    return result(id, name, "UNAVAILABLE", "UNKNOWN", ["All three PCR views are required before interpreting alignment."], [], ["full_chain_oi_pcr", "band7_oi_pcr", "volume_pcr"]);
  }
  const vals = [chain.full_chain_oi_pcr, chain.band7_oi_pcr, chain.volume_pcr];
  const spread = Math.max(...vals) - Math.min(...vals);
  if (spread > 0.65) return result(id, name, "CONFLICTING", "MIXED", ["PCR views diverge materially; do not collapse them into one bullish/bearish signal."], ["full-chain PCR", "±7 PCR", "volume PCR"]);
  return result(id, name, "NEUTRAL", "NONE", ["PCR views are relatively aligned, but PCR is positioning context rather than direction truth."], ["full-chain PCR", "±7 PCR", "volume PCR"]);
}

function comb06(m: MarketRow | null, options: OptionRow[]): MeaningfulCombinationResult {
  const id: CombinationId = "COMB-06";
  const name = "Underlying PDH/PDL + Premium PDH/PDL Confirmation";
  const { ce, pe } = atmPair(options);
  if (!m || !ce || !pe || !finite(m.spot_ltp) || !finite(m.pdh) || !finite(m.pdl)) {
    return result(id, name, "UNAVAILABLE", "UNKNOWN", ["Underlying and ATM premium day levels are incomplete."], [], ["spot/pdh/pdl", "ATM CE/PE pdh/pdl"]);
  }
  if (m.spot_ltp > m.pdh) {
    if (finite(ce.pdh) && finite(ce.ltp) && ce.ltp > ce.pdh && finite(pe.ltp) && finite(pe.pdl) && pe.ltp <= pe.pdl) {
      return result(id, name, "SUPPORTIVE", "BULLISH", ["Underlying is above PDH, CE premium confirms its PDH, and PE is weak versus PDL."], ["underlying levels", "CE levels", "PE levels"]);
    }
    return result(id, name, "WARNING", "BULLISH", ["Underlying PDH break lacks full premium confirmation."], ["underlying levels", "premium levels"]);
  }
  if (m.spot_ltp < m.pdl) {
    if (finite(pe.pdh) && finite(pe.ltp) && pe.ltp > pe.pdh && finite(ce.ltp) && finite(ce.pdl) && ce.ltp <= ce.pdl) {
      return result(id, name, "SUPPORTIVE", "BEARISH", ["Underlying is below PDL, PE premium confirms its PDH, and CE is weak versus PDL."], ["underlying levels", "CE levels", "PE levels"]);
    }
    return result(id, name, "WARNING", "BEARISH", ["Underlying PDL break lacks full premium confirmation."], ["underlying levels", "premium levels"]);
  }
  return result(id, name, "NEUTRAL", "NONE", ["Underlying remains inside PDH/PDL range."], ["underlying levels", "premium levels"]);
}

function comb07(chains: ChainRow[]): MeaningfulCombinationResult {
  const id: CombinationId = "COMB-07";
  const name = "Current + Next + Monthly Multi-expiry Alignment";
  const buckets = new Set(chains.map((c) => c.expiry_bucket).filter(Boolean));
  if (buckets.size < 2) return result(id, name, "UNAVAILABLE", "UNKNOWN", ["At least two expiry buckets are needed for cross-expiry comparison."], [], ["current/next/monthly chain states"]);
  const pcrs = chains.map((c) => c.band7_oi_pcr).filter(finite);
  if (pcrs.length < 2) return result(id, name, "UNAVAILABLE", "UNKNOWN", ["Cross-expiry ±7 PCR data is incomplete."], [], ["band7_oi_pcr across expiries"]);
  const spread = Math.max(...pcrs) - Math.min(...pcrs);
  if (spread > 0.6) return result(id, name, "CONFLICTING", "MIXED", ["Expiry positioning differs materially across stored expiries."], ["expiry_bucket", "band7_oi_pcr"]);
  return result(id, name, "NEUTRAL", "NONE", ["Stored expiry positioning is broadly aligned; direction still requires price/premium confirmation."], ["expiry_bucket", "band7_oi_pcr"]);
}

async function comb08(): Promise<MeaningfulCombinationResult> {
  const id: CombinationId = "COMB-08";
  const name = "Cross-index 15M Temporal Alignment";
  const symbols = ["NIFTY", "BANKNIFTY", "SENSEX"] as const;
  const states = await Promise.all(symbols.map((s) => deriveTemporalEvidenceState(s, "15M")));
  const usable = states.filter((s) => s.direction === "UP" || s.direction === "DOWN");
  if (usable.length < 2) return result(id, name, "UNAVAILABLE", "UNKNOWN", ["At least two usable 15M index directions are required."], [], ["NIFTY/BN/SENSEX 15M states"]);
  const up = usable.filter((s) => s.direction === "UP").length;
  const down = usable.filter((s) => s.direction === "DOWN").length;
  if (up >= 2) return result(id, name, "SUPPORTIVE", "BULLISH", [`${up} of ${usable.length} usable indices point UP on closed 15M blocks.`], ["cross-index 15M temporal state"]);
  if (down >= 2) return result(id, name, "SUPPORTIVE", "BEARISH", [`${down} of ${usable.length} usable indices point DOWN on closed 15M blocks.`], ["cross-index 15M temporal state"]);
  return result(id, name, "CONFLICTING", "MIXED", ["Usable 15M index directions disagree."], ["cross-index 15M temporal state"]);
}

export async function deriveMeaningfulCombinations(symbol: "NIFTY" | "BANKNIFTY" | "SENSEX"): Promise<MeaningfulCombinationSnapshot> {
  const marketQ = await dbQuerySafe<MarketRow>(`
    SELECT minute_bucket, spot_ltp, vwap, pdh, pdl, future_ltp, future_oi, india_vix
    FROM market_snapshot_1m
    WHERE symbol = $1
    ORDER BY minute_bucket DESC
    LIMIT 1
  `, [symbol]);
  const market = marketQ?.rows[0] ?? null;
  const minuteBucket = market ? new Date(market.minute_bucket).toISOString() : null;

  let options: OptionRow[] = [];
  let chains: ChainRow[] = [];
  if (minuteBucket) {
    const [optionQ, chainQ] = await Promise.all([
      dbQuerySafe<OptionRow>(`
        SELECT expiry, expiry_bucket, strike, option_type, atm_offset, ltp, oi, iv, delta, gamma, vega, theta,
               intrinsic, extrinsic, pdh, pdl, validation_status
        FROM option_snapshot_1m
        WHERE symbol = $1 AND minute_bucket = $2::timestamptz
        ORDER BY expiry, strike, option_type
      `, [symbol, minuteBucket]),
      dbQuerySafe<ChainRow>(`
        SELECT expiry, expiry_bucket, full_chain_oi_pcr, band7_oi_pcr, volume_pcr,
               call_wall_strike, call_wall_strength, put_wall_strike, put_wall_strength,
               atm_iv, straddle_ltp
        FROM chain_state_1m
        WHERE symbol = $1 AND minute_bucket = $2::timestamptz
        ORDER BY expiry
      `, [symbol, minuteBucket]),
    ]);
    options = optionQ?.rows ?? [];
    chains = chainQ?.rows ?? [];
  }

  const currentExpiry = chains[0] ?? null;
  const combinations: MeaningfulCombinationResult[] = [
    comb01(market),
    comb02(options),
    comb03(options, currentExpiry),
    comb04(market, currentExpiry),
    comb05(currentExpiry),
    comb06(market, options),
    comb07(chains),
    await comb08(),
  ];

  return {
    symbol,
    minuteBucket,
    combinations,
    availableCount: combinations.filter((c) => c.state !== "UNAVAILABLE").length,
    warningCount: combinations.filter((c) => c.state === "WARNING").length,
    conflictCount: combinations.filter((c) => c.state === "CONFLICTING").length,
    ruleVersion: "TEF_COMBINATION_V1",
    affectsVerdict: false,
    affectsTelegram: false,
    affectsExecution: false,
  };
}

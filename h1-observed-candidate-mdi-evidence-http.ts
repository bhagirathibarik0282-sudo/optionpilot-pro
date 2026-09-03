import { runH1ReplayHttp, type H1ReplayRequest } from "./h1-replay-http.js";
import { runH1ObservedCandidate30mGross } from "./h1-observed-candidate-30m-gross.js";
import { analyzeObservedCandidateMdiAvoidance, type ObservedCandidateMdiSample } from "./h1-observed-candidate-mdi-avoidance.js";
import type { MdiInput, MdiPoint, MdiSourceQualityMap } from "./mdi-research-shadow.js";

export interface H1ObservedCandidateMdiEvidenceHttpResult {
  ok: boolean;
  mode: "READ_ONLY_H1_OBSERVED_CANDIDATE_MDI_AVOIDANCE_V1";
  productionImpact: "NONE";
  request: H1ReplayRequest;
  mdiWindow: "EXACT_SIGNAL_MINUS_3M_TO_SIGNAL_NO_NEAREST_SUBSTITUTION";
  sourceBinding: "SAME_EXPIRY_CHAIN_SAME_EXPIRY_STRIKE_CE_PE_IV_EXACT_MARKET_MINUTE";
  grossEvidence: Awaited<ReturnType<typeof runH1ObservedCandidate30mGross>>;
  mdiAvoidance: ReturnType<typeof analyzeObservedCandidateMdiAvoidance>;
  boundSamples: number;
  rejectedSamples: number;
  rejectReasons: Record<string, number>;
  affectsVerdict: false;
  affectsTelegram: false;
  affectsExecution: false;
  createsOrders: false;
  aiMayOverride: false;
  reason?: string;
}

const s = (v: unknown): string => typeof v === "string" ? v : String(v ?? "");
const n = (v: unknown): number | null => typeof v === "number" && Number.isFinite(v) ? v : null;
const exactMs = (v: unknown): number | null => {
  const t = Date.parse(s(v));
  return Number.isFinite(t) ? t : null;
};
const verified = (row: Record<string, unknown> | undefined): boolean => !!row && s(row.truth_verdict) === "TRUE";
const strikeStep = (symbol: H1ReplayRequest["symbol"]): number => symbol === "BANKNIFTY" ? 100 : symbol === "SENSEX" ? 100 : 50;

function bump(map: Record<string, number>, key: string): void { map[key] = (map[key] ?? 0) + 1; }

function quality(params: {
  market: Record<string, unknown> | undefined;
  chain: Record<string, unknown> | undefined;
  ce: Record<string, unknown> | undefined;
  pe: Record<string, unknown> | undefined;
}): MdiSourceQualityMap {
  return {
    PCR: verified(params.chain) ? "VERIFIED" : "UNKNOWN",
    WALL: verified(params.chain) ? "VERIFIED" : "UNKNOWN",
    IV: verified(params.ce) && verified(params.pe) ? "VERIFIED" : "UNKNOWN",
    VIX: verified(params.market) ? "VERIFIED" : "UNKNOWN",
    FUTURES: verified(params.market) ? "VERIFIED" : "UNKNOWN",
  };
}

function buildPoint(
  ts: string,
  market: Record<string, unknown> | undefined,
  chain: Record<string, unknown> | undefined,
  ce: Record<string, unknown> | undefined,
  pe: Record<string, unknown> | undefined,
): MdiPoint {
  return {
    ts,
    sourceQuality: quality({ market, chain, ce, pe }),
    fullPcr: n(chain?.full_chain_oi_pcr),
    band7Pcr: n(chain?.band7_oi_pcr),
    callWallStrike: n(chain?.call_wall_strike),
    putWallStrike: n(chain?.put_wall_strike),
    callWallStrength: n(chain?.call_wall_strength),
    putWallStrength: n(chain?.put_wall_strength),
    ceIv: n(ce?.iv),
    peIv: n(pe?.iv),
    indiaVix: n(market?.india_vix),
    futureLtp: n(market?.future_ltp),
  };
}

export async function runH1ObservedCandidateMdiEvidenceHttp(request: H1ReplayRequest): Promise<H1ObservedCandidateMdiEvidenceHttpResult> {
  const [replay, grossEvidence] = await Promise.all([
    runH1ReplayHttp(request),
    runH1ObservedCandidate30mGross(request),
  ]);
  const rejectReasons: Record<string, number> = {};
  if (!replay.ok) {
    return {
      ok: false,
      mode: "READ_ONLY_H1_OBSERVED_CANDIDATE_MDI_AVOIDANCE_V1",
      productionImpact: "NONE",
      request,
      mdiWindow: "EXACT_SIGNAL_MINUS_3M_TO_SIGNAL_NO_NEAREST_SUBSTITUTION",
      sourceBinding: "SAME_EXPIRY_CHAIN_SAME_EXPIRY_STRIKE_CE_PE_IV_EXACT_MARKET_MINUTE",
      grossEvidence,
      mdiAvoidance: analyzeObservedCandidateMdiAvoidance([]),
      boundSamples: 0,
      rejectedSamples: grossEvidence.sampleCount,
      rejectReasons: { H1_REPLAY_UNAVAILABLE: grossEvidence.sampleCount },
      affectsVerdict: false,
      affectsTelegram: false,
      affectsExecution: false,
      createsOrders: false,
      aiMayOverride: false,
      reason: replay.reason,
    };
  }

  const market = replay.market ?? [];
  const chain = replay.chain ?? [];
  const options = replay.options ?? [];
  const findMarket = (ms: number) => market.filter(r => exactMs(r.minute_bucket) === ms);
  const findChain = (ms: number, expiry: string) => chain.filter(r => exactMs(r.minute_bucket) === ms && s(r.expiry) === expiry);
  const findOption = (ms: number, expiry: string, strike: number, side: "CE"|"PE") => options.filter(r => exactMs(r.minute_bucket) === ms && s(r.expiry) === expiry && n(r.strike) === strike && s(r.option_type) === side);

  const bound: ObservedCandidateMdiSample[] = [];
  for (const payoff of grossEvidence.samples) {
    const signalMs = Date.parse(payoff.signalTs);
    const prevMs = signalMs - 3 * 60_000;
    const curMarket = findMarket(signalMs);
    const prevMarket = findMarket(prevMs);
    const curChain = findChain(signalMs, payoff.expiry);
    const prevChain = findChain(prevMs, payoff.expiry);
    const curCe = findOption(signalMs, payoff.expiry, payoff.strike, "CE");
    const curPe = findOption(signalMs, payoff.expiry, payoff.strike, "PE");
    const prevCe = findOption(prevMs, payoff.expiry, payoff.strike, "CE");
    const prevPe = findOption(prevMs, payoff.expiry, payoff.strike, "PE");

    const groups: Array<[string, unknown[]]> = [
      ["CURRENT_MARKET_NOT_EXACTLY_ONE", curMarket],
      ["PREVIOUS_MARKET_NOT_EXACTLY_ONE", prevMarket],
      ["CURRENT_CHAIN_NOT_EXACTLY_ONE", curChain],
      ["PREVIOUS_CHAIN_NOT_EXACTLY_ONE", prevChain],
      ["CURRENT_CE_NOT_EXACTLY_ONE", curCe],
      ["CURRENT_PE_NOT_EXACTLY_ONE", curPe],
      ["PREVIOUS_CE_NOT_EXACTLY_ONE", prevCe],
      ["PREVIOUS_PE_NOT_EXACTLY_ONE", prevPe],
    ];
    const bad = groups.find(([, rows]) => rows.length !== 1);
    if (bad) { bump(rejectReasons, bad[0]); continue; }

    const mdiInput: MdiInput = {
      previous: buildPoint(new Date(prevMs).toISOString(), prevMarket[0], prevChain[0], prevCe[0], prevPe[0]),
      current: buildPoint(payoff.signalTs, curMarket[0], curChain[0], curCe[0], curPe[0]),
      strikeStep: strikeStep(request.symbol),
    };
    bound.push({
      sampleId: `${payoff.signalTs}|${payoff.expiry}|${payoff.strike}|${payoff.side}|30`,
      payoff,
      mdiInput,
    });
  }

  const mdiAvoidance = analyzeObservedCandidateMdiAvoidance(bound);
  const rejectedSamples = grossEvidence.sampleCount - bound.length;
  if (!grossEvidence.ok) bump(rejectReasons, "GROSS_EVIDENCE_HAS_BLOCKERS");
  if (!bound.length) bump(rejectReasons, "NO_EXACT_T_MINUS_3M_MDI_BINDINGS");

  return {
    ok: grossEvidence.ok && mdiAvoidance.state === "USABLE" && rejectedSamples === 0,
    mode: "READ_ONLY_H1_OBSERVED_CANDIDATE_MDI_AVOIDANCE_V1",
    productionImpact: "NONE",
    request,
    mdiWindow: "EXACT_SIGNAL_MINUS_3M_TO_SIGNAL_NO_NEAREST_SUBSTITUTION",
    sourceBinding: "SAME_EXPIRY_CHAIN_SAME_EXPIRY_STRIKE_CE_PE_IV_EXACT_MARKET_MINUTE",
    grossEvidence,
    mdiAvoidance,
    boundSamples: bound.length,
    rejectedSamples,
    rejectReasons,
    affectsVerdict: false,
    affectsTelegram: false,
    affectsExecution: false,
    createsOrders: false,
    aiMayOverride: false,
  };
}

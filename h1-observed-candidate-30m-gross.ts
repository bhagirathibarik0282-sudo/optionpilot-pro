import { runH1ReplayHttp, type H1ReplayRequest } from "./h1-replay-http.js";

export interface ObservedCandidate30mSample {
  signalTs: string;
  exitTs: string;
  symbol: string;
  expiry: string;
  dte: number;
  strike: number;
  side: "CE" | "PE";
  entryAsk: number;
  exitBid: number;
  grossReturnPct: number;
}

export interface H1ObservedCandidate30mGrossResult {
  ok: boolean;
  mode: "READ_ONLY_H1_OBSERVED_CANDIDATE_30M_GROSS_V1";
  productionImpact: "NONE";
  request: H1ReplayRequest;
  semantics: "OBSERVED_H1_IS_CANDIDATE_ONLY_NOT_EXECUTION_SELECTOR_PROOF";
  pricePolicy: "BUY_AT_RECORDED_ASK_SELL_AT_EXACT_PLUS_30M_RECORDED_BID";
  horizonPolicy: "EXACT_PLUS_30_MINUTES_NO_NEAREST_SUBSTITUTION";
  sampleCount: number;
  positiveCount: number;
  lossCount: number;
  positiveRatePct: number | null;
  lossRatePct: number | null;
  averageGrossReturnPct: number | null;
  samples: ObservedCandidate30mSample[];
  blockers: string[];
  affectsVerdict: false;
  affectsTelegram: false;
  affectsExecution: false;
  createsOrders: false;
  aiMayOverride: false;
  reason?: string;
}

const n = (v: unknown): number | null => typeof v === "number" && Number.isFinite(v) ? v : null;
const s = (v: unknown): string => typeof v === "string" ? v : String(v ?? "");
const b = (v: unknown): boolean => v === true || v === "true";

export async function runH1ObservedCandidate30mGross(request: H1ReplayRequest): Promise<H1ObservedCandidate30mGrossResult> {
  const replay = await runH1ReplayHttp(request);
  const blockers: string[] = [];
  if (!replay.ok) {
    return {
      ok: false,
      mode: "READ_ONLY_H1_OBSERVED_CANDIDATE_30M_GROSS_V1",
      productionImpact: "NONE",
      request,
      semantics: "OBSERVED_H1_IS_CANDIDATE_ONLY_NOT_EXECUTION_SELECTOR_PROOF",
      pricePolicy: "BUY_AT_RECORDED_ASK_SELL_AT_EXACT_PLUS_30M_RECORDED_BID",
      horizonPolicy: "EXACT_PLUS_30_MINUTES_NO_NEAREST_SUBSTITUTION",
      sampleCount: 0,
      positiveCount: 0,
      lossCount: 0,
      positiveRatePct: null,
      lossRatePct: null,
      averageGrossReturnPct: null,
      samples: [],
      blockers: [replay.reason ?? "H1_REPLAY_UNAVAILABLE"],
      affectsVerdict: false,
      affectsTelegram: false,
      affectsExecution: false,
      createsOrders: false,
      aiMayOverride: false,
      reason: replay.reason,
    };
  }

  const rows = [...(replay.options ?? [])];
  const byKey = new Map<string, Record<string, unknown>[]>();
  for (const row of rows) {
    const key = `${s(row.expiry)}|${n(row.strike)}|${s(row.option_type)}`;
    const arr = byKey.get(key) ?? [];
    arr.push(row);
    byKey.set(key, arr);
  }
  for (const arr of byKey.values()) arr.sort((a, z) => s(a.minute_bucket).localeCompare(s(z.minute_bucket)));

  const samples: ObservedCandidate30mSample[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (!b(row.is_candidate) || s(row.truth_verdict) !== "TRUE") continue;
    const signalMs = Date.parse(s(row.minute_bucket));
    if (!Number.isFinite(signalMs)) continue;
    const entryAsk = n(row.ask);
    const strike = n(row.strike);
    const dte = n(row.dte);
    const side = s(row.option_type);
    if (entryAsk == null || entryAsk <= 0 || strike == null || dte == null || !Number.isInteger(dte) || (side !== "CE" && side !== "PE")) continue;
    const targetMs = signalMs + 30 * 60_000;
    const key = `${s(row.expiry)}|${strike}|${side}`;
    const exact = (byKey.get(key) ?? []).filter((x) => Date.parse(s(x.minute_bucket)) === targetMs && s(x.truth_verdict) === "TRUE");
    if (exact.length !== 1) continue;
    const exitBid = n(exact[0].bid);
    if (exitBid == null || exitBid <= 0) continue;
    const logical = `${signalMs}|${key}|30`;
    if (seen.has(logical)) { blockers.push("DUPLICATE_LOGICAL_SIGNAL_CONTRACT_HORIZON"); continue; }
    seen.add(logical);
    samples.push({
      signalTs: new Date(signalMs).toISOString(),
      exitTs: new Date(targetMs).toISOString(),
      symbol: request.symbol,
      expiry: s(row.expiry),
      dte,
      strike,
      side,
      entryAsk,
      exitBid,
      grossReturnPct: ((exitBid - entryAsk) / entryAsk) * 100,
    });
  }

  if (!samples.length) blockers.push("NO_OBSERVED_CANDIDATE_EXACT30M_SAMPLES");
  const positiveCount = samples.filter((x) => x.grossReturnPct > 0).length;
  const lossCount = samples.filter((x) => x.grossReturnPct < 0).length;
  const averageGrossReturnPct = samples.length ? samples.reduce((a, x) => a + x.grossReturnPct, 0) / samples.length : null;

  return {
    ok: blockers.length === 0,
    mode: "READ_ONLY_H1_OBSERVED_CANDIDATE_30M_GROSS_V1",
    productionImpact: "NONE",
    request,
    semantics: "OBSERVED_H1_IS_CANDIDATE_ONLY_NOT_EXECUTION_SELECTOR_PROOF",
    pricePolicy: "BUY_AT_RECORDED_ASK_SELL_AT_EXACT_PLUS_30M_RECORDED_BID",
    horizonPolicy: "EXACT_PLUS_30_MINUTES_NO_NEAREST_SUBSTITUTION",
    sampleCount: samples.length,
    positiveCount,
    lossCount,
    positiveRatePct: samples.length ? positiveCount / samples.length * 100 : null,
    lossRatePct: samples.length ? lossCount / samples.length * 100 : null,
    averageGrossReturnPct,
    samples,
    blockers: [...new Set(blockers)],
    affectsVerdict: false,
    affectsTelegram: false,
    affectsExecution: false,
    createsOrders: false,
    aiMayOverride: false,
  };
}

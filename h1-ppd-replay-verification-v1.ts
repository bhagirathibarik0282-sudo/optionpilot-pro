import type { H1ReplayHttpResult, H1ReplayRequest } from "./h1-replay-http.js";
import {
  calculatePremiumPairDivergence,
  type PpdQuote,
  type PpdWindowResult,
} from "./h1-premium-pair-divergence-v1.js";
import { buildMultiDtePpdContext } from "./h1-multi-dte-ppd-context-v1.js";

export const H1_PPD_REPLAY_VERIFICATION_VERSION = "H1_PPD_REPLAY_VERIFICATION_V1" as const;
export const H1_PPD_REPLAY_WINDOWS_MINUTES = [3, 6, 15] as const;
export const H1_PPD_REPLAY_MAX_WINDOWS = 40;

type ReplayRow = Record<string, unknown>;
type Side = "CE" | "PE";

type ReplayPoint = {
  minute: string;
  indexSymbol: string;
  expiry: string;
  dte: number;
  strike: number;
  side: Side;
  price: number;
  quoteAgeMs: number | null;
  spreadBps: number | null;
  stale: boolean;
};

function n(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function s(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function iso(value: unknown): string | null {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
  }
  return null;
}

function spreadBps(row: ReplayRow): number | null {
  const bid = n(row.bid);
  const ask = n(row.ask);
  if (bid != null && ask != null && bid > 0 && ask >= bid) {
    const mid = (bid + ask) / 2;
    return mid > 0 ? ((ask - bid) / mid) * 10_000 : null;
  }
  const spread = n(row.spread);
  const ltp = n(row.ltp);
  if (spread != null && ltp != null && ltp > 0 && spread >= 0) return (spread / ltp) * 10_000;
  return null;
}

function replayPoint(row: ReplayRow, request: H1ReplayRequest): ReplayPoint | null {
  const minute = iso(row.minute_bucket);
  const indexSymbol = s(row.symbol) ?? request.symbol;
  const expiry = iso(row.expiry)?.slice(0, 10) ?? s(row.expiry);
  const dte = n(row.dte);
  const strike = n(row.strike);
  const side = s(row.option_type);
  const atmOffset = n(row.atm_offset);
  const price = n(row.ltp);
  if (!minute || !expiry || dte == null || strike == null || atmOffset !== 0 || price == null || price <= 0) return null;
  if (side !== "CE" && side !== "PE") return null;
  const quoteAgeSeconds = n(row.quote_age_seconds);
  const validation = (s(row.validation_status) ?? "").toUpperCase();
  const truth = (s(row.truth_verdict) ?? "").toUpperCase();
  return {
    minute,
    indexSymbol,
    expiry,
    dte,
    strike,
    side,
    price,
    quoteAgeMs: quoteAgeSeconds == null ? null : quoteAgeSeconds * 1000,
    spreadBps: spreadBps(row),
    stale: validation.includes("STALE") || truth === "STALE",
  };
}

function key(point: Pick<ReplayPoint, "minute" | "expiry" | "strike" | "side">): string {
  return `${point.minute}|${point.expiry}|${point.strike}|${point.side}`;
}

function quote(point: ReplayPoint): PpdQuote {
  return {
    timestamp: point.minute,
    indexSymbol: point.indexSymbol,
    expiry: point.expiry,
    strike: point.strike,
    side: point.side,
    price: point.price,
    priceSource: "LTP_REPLAY",
    quoteAgeMs: point.quoteAgeMs,
    spreadBps: point.spreadBps,
    stale: point.stale,
  };
}

export function buildH1PpdReplayVerification(
  request: H1ReplayRequest,
  replay: H1ReplayHttpResult,
  maxWindows = H1_PPD_REPLAY_MAX_WINDOWS,
) {
  const boundedMax = Number.isInteger(maxWindows) && maxWindows >= 1 && maxWindows <= H1_PPD_REPLAY_MAX_WINDOWS
    ? maxWindows
    : H1_PPD_REPLAY_MAX_WINDOWS;

  if (!replay.ok) {
    return {
      ok: false as const,
      mode: H1_PPD_REPLAY_VERIFICATION_VERSION,
      productionImpact: "NONE" as const,
      researchOnly: true as const,
      request,
      reason: replay.reason ?? "H1_REPLAY_UNAVAILABLE",
      safety: {
        affectsSelector: false as const,
        affectsTelegram: false as const,
        affectsVerdict: false as const,
        affectsExecution: false as const,
        thresholdPromoted: false as const,
      },
    };
  }

  const points = (replay.options ?? [])
    .map((row) => replayPoint(row, request))
    .filter((point): point is ReplayPoint => point !== null);
  const byKey = new Map(points.map((point) => [key(point), point] as const));
  const endpoints = new Map<string, ReplayPoint>();
  for (const point of points) {
    if (point.side === "CE") endpoints.set(`${point.minute}|${point.expiry}|${point.strike}`, point);
  }

  const windows: Array<{
    windowMinutes: 3 | 6 | 15;
    dte: number;
    result: PpdWindowResult;
  }> = [];
  let invalidPairCount = 0;

  for (const endpoint of endpoints.values()) {
    const peTo = byKey.get(`${endpoint.minute}|${endpoint.expiry}|${endpoint.strike}|PE`);
    if (!peTo) continue;
    for (const windowMinutes of H1_PPD_REPLAY_WINDOWS_MINUTES) {
      const fromMinute = new Date(Date.parse(endpoint.minute) - windowMinutes * 60_000).toISOString();
      const ceFrom = byKey.get(`${fromMinute}|${endpoint.expiry}|${endpoint.strike}|CE`);
      const peFrom = byKey.get(`${fromMinute}|${endpoint.expiry}|${endpoint.strike}|PE`);
      if (!ceFrom || !peFrom) continue;
      const result = calculatePremiumPairDivergence({
        ceFrom: quote(ceFrom),
        ceTo: quote(endpoint),
        peFrom: quote(peFrom),
        peTo: quote(peTo),
      });
      if (!result.ok) invalidPairCount += 1;
      windows.push({ windowMinutes, dte: endpoint.dte, result });
    }
  }

  const valid = windows.filter((x): x is { windowMinutes: 3 | 6 | 15; dte: number; result: Extract<PpdWindowResult, { ok: true }> } => x.result.ok);
  const ranked = [...valid]
    .sort((a, b) => b.result.candidate.netPpdSeparationPp - a.result.candidate.netPpdSeparationPp || Date.parse(a.result.to) - Date.parse(b.result.to))
    .slice(0, boundedMax)
    .map((x) => ({
      windowMinutes: x.windowMinutes,
      dte: x.dte,
      expiry: x.result.expiry,
      strike: x.result.strike,
      from: x.result.from,
      to: x.result.to,
      ceReturnPct: x.result.ceReturnPct,
      peReturnPct: x.result.peReturnPct,
      controllingSide: x.result.controllingSide,
      pairState: x.result.pairState,
      expansionStrengthPct: x.result.candidate.expansionStrengthPct,
      oppositeCollapseStrengthPct: x.result.candidate.oppositeCollapseStrengthPct,
      netPpdSeparationPp: x.result.candidate.netPpdSeparationPp,
      ppdRatePpPerMinute: x.result.windowRate.rawPpdPpPerMinute,
      quality: x.result.quality,
    }));

  const multiDte = new Map<string, ReturnType<typeof buildMultiDtePpdContext>>();
  const grouped = new Map<string, Array<{ dte: number; result: PpdWindowResult }>>();
  for (const item of valid) {
    const groupKey = `${item.result.to}|${item.windowMinutes}`;
    const group = grouped.get(groupKey) ?? [];
    group.push({ dte: item.dte, result: item.result });
    grouped.set(groupKey, group);
  }
  for (const [groupKey, group] of grouped) {
    if (group.length >= 2) multiDte.set(groupKey, buildMultiDtePpdContext(group));
  }

  const multiDteSnapshots = [...multiDte.entries()]
    .map(([groupKey, context]) => {
      const [to, windowMinutes] = groupKey.split("|");
      return { to, windowMinutes: Number(windowMinutes), context };
    })
    .filter((x) => x.context.ok)
    .sort((a, b) => Date.parse(a.to) - Date.parse(b.to));

  return {
    ok: true as const,
    mode: H1_PPD_REPLAY_VERIFICATION_VERSION,
    productionImpact: "NONE" as const,
    researchOnly: true as const,
    request,
    semantics: "HISTORICAL_ENTRY_TIME_PPD_EVIDENCE_ONLY" as const,
    source: {
      replayMode: replay.mode,
      priceSource: "LTP_REPLAY" as const,
      rawOptionRows: replay.options?.length ?? 0,
      atmPointsUsed: points.length,
      continuity: replay.continuity ?? null,
    },
    verification: {
      candidateWindowsComputed: windows.length,
      validWindows: valid.length,
      invalidPairCount,
      multiDteSnapshots: multiDteSnapshots.length,
      windows: ranked,
      multiDte: multiDteSnapshots,
    },
    interpretation: {
      noHindsightOutcomeUsed: true as const,
      ppdIsEvidenceNotTrigger: true as const,
      sameThresholdAcrossDte: false as const,
      winnerOnlyThresholdPromoted: false as const,
      falseWindowCalibrationStillRequired: true as const,
    },
    boundedOutput: {
      maxWindows: boundedMax,
      rawOptionRowsOmitted: true as const,
    },
    safety: {
      affectsSelector: false as const,
      affectsTelegram: false as const,
      affectsVerdict: false as const,
      affectsExecution: false as const,
      brokerCallMade: false as const,
      placesOrder: false as const,
      thresholdPromoted: false as const,
    },
  };
}

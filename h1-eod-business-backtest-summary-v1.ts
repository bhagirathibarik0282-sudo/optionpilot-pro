import type { H1ReplayHttpResult, H1ReplayRequest } from "./h1-replay-http.js";
import { buildH1Dte0TransitionCalibration } from "./h1-dte0-transition-calibration-v1.js";
import { auditCandidateReconstruction } from "./h1-candidate-reconstruction-audit.js";

export const H1_EOD_BUSINESS_BACKTEST_SUMMARY_VERSION = "H1_EOD_BUSINESS_BACKTEST_SUMMARY_V1" as const;
export const H1_EOD_BUSINESS_BACKTEST_DEFAULT_TOP = 10;
export const H1_EOD_BUSINESS_BACKTEST_MAX_TOP = 20;

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

function pctChange(previous: number | null, current: number | null): number | null {
  if (previous == null || current == null || previous <= 0) return null;
  return ((current - previous) / previous) * 100;
}

function atOffsetIso(baseIso: string, minutes: number): string {
  return new Date(Date.parse(baseIso) + minutes * 60_000).toISOString();
}

export function parseH1EodBusinessBacktestTop(raw: string | null | undefined):
  | { ok: true; value: number }
  | { ok: false; reason: "INVALID_TOP" } {
  if (raw == null || String(raw).trim() === "") return { ok: true, value: H1_EOD_BUSINESS_BACKTEST_DEFAULT_TOP };
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > H1_EOD_BUSINESS_BACKTEST_MAX_TOP) {
    return { ok: false, reason: "INVALID_TOP" };
  }
  return { ok: true, value };
}

type ReplayRow = Record<string, unknown>;
type Side = "CE" | "PE";

type ForwardOutcome = {
  horizonMinutes: 6 | 15 | 30;
  observedAt: string;
  premiumLtp: number;
  premiumMovePctFromWindowEnd: number | null;
};

type AtmPoint = {
  minute: string;
  expiry: string;
  dte: number;
  side: Side;
  strike: number;
  atmOffset: number;
  ltp: number;
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  iv: number | null;
  liquidityStatus: string | null;
  validationStatus: string | null;
};

type ObservedTransition = {
  expiry: string;
  dte: number;
  side: Side;
  strike: number;
  from: string;
  to: string;
  observed: {
    premiumLtpFrom: number;
    premiumLtpTo: number;
    premiumMovePct: number | null;
    deltaFrom: number | null;
    deltaTo: number | null;
    absoluteDeltaChange: number | null;
    currentGamma: number | null;
    theta: number | null;
    iv: number | null;
    liquidityStatus: string | null;
    validationStatus: string | null;
  };
};

function minuteMap(rows: ReplayRow[]): Map<string, ReplayRow> {
  const out = new Map<string, ReplayRow>();
  for (const row of rows) {
    const minute = iso(row.minute_bucket);
    if (minute) out.set(minute, row);
  }
  return out;
}

function currentExpiryChainMap(rows: ReplayRow[]): Map<string, ReplayRow> {
  const out = new Map<string, ReplayRow>();
  for (const row of rows) {
    const minute = iso(row.minute_bucket);
    if (!minute || s(row.expiry_bucket) !== "Current Expiry") continue;
    out.set(minute, row);
  }
  return out;
}

function toCurrentExpiryPoint(row: ReplayRow): AtmPoint | null {
  const minute = iso(row.minute_bucket);
  const expiry = iso(row.expiry)?.slice(0, 10) ?? s(row.expiry);
  const side = s(row.option_type);
  const dte = n(row.dte);
  const strike = n(row.strike);
  const atmOffset = n(row.atm_offset);
  const ltp = n(row.ltp);
  if (!minute || !expiry || (side !== "CE" && side !== "PE")) return null;
  if (dte == null || strike == null || atmOffset == null || ltp == null || ltp <= 0) return null;
  if (s(row.expiry_bucket) !== "Current Expiry") return null;
  return {
    minute,
    expiry,
    dte,
    side,
    strike,
    atmOffset,
    ltp,
    delta: n(row.delta),
    gamma: n(row.gamma),
    theta: n(row.theta),
    iv: n(row.iv),
    liquidityStatus: s(row.liquidity_status),
    validationStatus: s(row.validation_status),
  };
}

function buildObservedAtmTransitions(rows: ReplayRow[]): { transitions: ObservedTransition[]; optionByKey: Map<string, AtmPoint> } {
  const points = rows.map(toCurrentExpiryPoint).filter((x): x is AtmPoint => x !== null);
  const optionByKey = new Map<string, AtmPoint>();
  const groups = new Map<string, AtmPoint[]>();

  for (const point of points) {
    optionByKey.set(`${point.minute}|${point.expiry}|${point.side}|${point.strike}`, point);
    const key = `${point.expiry}|${point.side}|${point.strike}`;
    const group = groups.get(key) ?? [];
    group.push(point);
    groups.set(key, group);
  }

  const transitions: ObservedTransition[] = [];
  for (const group of groups.values()) {
    group.sort((a, b) => Date.parse(a.minute) - Date.parse(b.minute));
    for (let i = 1; i < group.length; i += 1) {
      const previous = group[i - 1];
      const current = group[i];
      if (Date.parse(current.minute) - Date.parse(previous.minute) !== 3 * 60_000) continue;
      if (current.atmOffset !== 0) continue;
      const absoluteDeltaChange = previous.delta != null && current.delta != null
        ? Math.abs(current.delta - previous.delta)
        : null;
      transitions.push({
        expiry: current.expiry,
        dte: current.dte,
        side: current.side,
        strike: current.strike,
        from: previous.minute,
        to: current.minute,
        observed: {
          premiumLtpFrom: previous.ltp,
          premiumLtpTo: current.ltp,
          premiumMovePct: pctChange(previous.ltp, current.ltp),
          deltaFrom: previous.delta,
          deltaTo: current.delta,
          absoluteDeltaChange,
          currentGamma: current.gamma,
          theta: current.theta,
          iv: current.iv,
          liquidityStatus: current.liquidityStatus,
          validationStatus: current.validationStatus,
        },
      });
    }
  }

  return { transitions, optionByKey };
}

function sessionSummary(marketRows: ReplayRow[]) {
  const sorted = marketRows
    .map((row) => ({ row, minute: iso(row.minute_bucket) }))
    .filter((x): x is { row: ReplayRow; minute: string } => x.minute !== null)
    .sort((a, b) => Date.parse(a.minute) - Date.parse(b.minute));
  const first = sorted[0]?.row ?? null;
  const last = sorted[sorted.length - 1]?.row ?? null;
  const open = n(last?.spot_open) ?? n(first?.spot_ltp);
  const high = n(last?.spot_high) ?? null;
  const low = n(last?.spot_low) ?? null;
  const close = n(last?.spot_ltp) ?? null;
  const previousClose = n(last?.spot_prev_close) ?? n(first?.spot_prev_close);
  return {
    firstObserved: sorted[0]?.minute ?? null,
    lastObserved: sorted[sorted.length - 1]?.minute ?? null,
    spotOpen: open,
    spotHigh: high,
    spotLow: low,
    spotClose: close,
    previousClose,
    openToClosePct: pctChange(open, close),
    previousCloseToClosePct: pctChange(previousClose, close),
  };
}

function policyBlockers(policy: {
  premiumPass: boolean;
  deltaGammaPass: boolean;
  thetaIvPass: boolean;
}): string[] {
  const blockers: string[] = [];
  if (!policy.premiumPass) blockers.push("PREMIUM_RESPONSE_NOT_CONFIRMED");
  if (!policy.deltaGammaPass) blockers.push("DELTA_GAMMA_RESPONSE_NOT_CONFIRMED");
  if (!policy.thetaIvPass) blockers.push("THETA_IV_BURDEN_UNACCEPTABLE");
  return blockers;
}

export function buildH1EodBusinessBacktestSummary(
  request: H1ReplayRequest,
  replay: H1ReplayHttpResult,
  top = H1_EOD_BUSINESS_BACKTEST_DEFAULT_TOP,
) {
  const boundedTop = Number.isInteger(top) && top >= 1 && top <= H1_EOD_BUSINESS_BACKTEST_MAX_TOP
    ? top
    : H1_EOD_BUSINESS_BACKTEST_DEFAULT_TOP;
  const reconstruction = auditCandidateReconstruction(request, replay);

  if (!replay.ok) {
    return {
      ok: false,
      mode: H1_EOD_BUSINESS_BACKTEST_SUMMARY_VERSION,
      productionImpact: "NONE" as const,
      semantics: "HISTORICAL_REPLAY_RESEARCH_RECONSTRUCTION_ONLY" as const,
      request,
      reason: replay.reason ?? "H1_REPLAY_UNAVAILABLE",
      canonicalLiveProof: false as const,
      selectorQualificationProven: false as const,
      safety: {
        readOnly: true as const,
        researchOnly: true as const,
        affectsSelector: false as const,
        affectsTelegram: false as const,
        affectsVerdict: false as const,
        affectsExecution: false as const,
        brokerCallMade: false as const,
        placesOrder: false as const,
        thresholdPromoted: false as const,
        failClosed: true as const,
      },
    };
  }

  const calibration = buildH1Dte0TransitionCalibration(request, replay);
  const { transitions, optionByKey } = buildObservedAtmTransitions(replay.options ?? []);
  const marketByMinute = minuteMap(replay.market ?? []);
  const chainByMinute = currentExpiryChainMap(replay.chain ?? []);
  const dte0PolicyByWindow = new Map(
    calibration.windows.map((window) => [`${window.from}|${window.to}|${window.side}|${window.strike}`, window.currentPolicy] as const),
  );

  const blockerCounts: Record<string, number> = {};
  for (const window of calibration.windows) {
    for (const blocker of policyBlockers(window.currentPolicy)) {
      blockerCounts[blocker] = (blockerCounts[blocker] ?? 0) + 1;
    }
  }

  const ranked = [...transitions]
    .sort((a, b) => {
      const aMove = Math.abs(a.observed.premiumMovePct ?? 0);
      const bMove = Math.abs(b.observed.premiumMovePct ?? 0);
      return bMove - aMove || Date.parse(a.to) - Date.parse(b.to);
    })
    .slice(0, boundedTop)
    .map((window) => {
      const market = marketByMinute.get(window.to);
      const chain = chainByMinute.get(window.to);
      const responsePolicy = dte0PolicyByWindow.get(`${window.from}|${window.to}|${window.side}|${window.strike}`) ?? null;
      const blockers = responsePolicy ? policyBlockers(responsePolicy) : [];
      const forwardOutcomes = ([6, 15, 30] as const)
        .map((horizonMinutes): ForwardOutcome | null => {
          const observedAt = atOffsetIso(window.to, horizonMinutes);
          const point = optionByKey.get(`${observedAt}|${window.expiry}|${window.side}|${window.strike}`);
          if (!point) return null;
          return {
            horizonMinutes,
            observedAt,
            premiumLtp: point.ltp,
            premiumMovePctFromWindowEnd: pctChange(window.observed.premiumLtpTo, point.ltp),
          };
        })
        .filter((x): x is ForwardOutcome => x !== null);

      return {
        expiry: window.expiry,
        dte: window.dte,
        side: window.side,
        strike: window.strike,
        from: window.from,
        to: window.to,
        observed: window.observed,
        responsePolicy,
        responsePolicySource: responsePolicy ? "EXISTING_DTE0_CALIBRATION_POLICY" as const : "NOT_APPLIED_OUTSIDE_DTE0" as const,
        responsePolicyBlockers: blockers,
        responsePolicyState: responsePolicy
          ? (blockers.length === 0 ? "RESPONSE_POLICY_PASS" as const : "RESPONSE_POLICY_BLOCKED" as const)
          : "POLICY_NOT_RECONSTRUCTED" as const,
        selectorQualification: "NOT_PROVEN_FROM_HISTORICAL_REPLAY" as const,
        marketContext: {
          spotLtp: n(market?.spot_ltp),
          vwap: n(market?.vwap),
          pdh: n(market?.pdh),
          pdl: n(market?.pdl),
          futureLtp: n(market?.future_ltp),
          futureOi: n(market?.future_oi),
          futureOiChange: n(market?.future_oi_change),
          futureBasis: n(market?.future_basis),
          indiaVix: n(market?.india_vix),
          indiaVixChange: n(market?.india_vix_change),
        },
        positioningContext: {
          fullChainOiPcr: n(chain?.full_chain_oi_pcr),
          band7OiPcr: n(chain?.band7_oi_pcr),
          volumePcr: n(chain?.volume_pcr),
          maxPain: n(chain?.max_pain),
          callWallStrike: n(chain?.call_wall_strike),
          callWallOi: n(chain?.call_wall_oi),
          callWallMigration: n(chain?.call_wall_migration),
          putWallStrike: n(chain?.put_wall_strike),
          putWallOi: n(chain?.put_wall_oi),
          putWallMigration: n(chain?.put_wall_migration),
        },
        forwardOutcomes,
      };
    });

  return {
    ok: true,
    mode: H1_EOD_BUSINESS_BACKTEST_SUMMARY_VERSION,
    productionImpact: "NONE" as const,
    semantics: "HISTORICAL_REPLAY_RESEARCH_RECONSTRUCTION_ONLY" as const,
    request,
    canonicalLiveProof: false as const,
    selectorQualificationProven: false as const,
    dataQuality: {
      replayCounts: replay.counts ?? null,
      continuity: replay.continuity ?? null,
    },
    session: sessionSummary(replay.market ?? []),
    reconstruction: {
      businessUse: reconstruction.businessUse,
      fullSelectorReconstructionPossible: reconstruction.fullSelectorReconstructionPossible,
      reconstructableGateCount: reconstruction.reconstructableGateCount,
      partialGateCount: reconstruction.partialGateCount,
      notRecordedGateCount: reconstruction.notRecordedGateCount,
      provableGates: reconstruction.provableGates,
      partialGates: reconstruction.partialGates,
      unprovableGates: reconstruction.unprovableGates,
      blockers: reconstruction.blockers,
    },
    transitionEvidence: {
      semantics: "CURRENT_EXPIRY_ATM_OBSERVED_3M_TRANSITIONS_RESEARCH_ONLY" as const,
      totalObservedWindowCount: transitions.length,
      topRequested: boundedTop,
      topReturned: ranked.length,
      ranking: "ABSOLUTE_OBSERVED_PREMIUM_MOVE_ONLY_NOT_CANDIDATE_SCORE" as const,
      windows: ranked,
    },
    dte0Evidence: {
      atmDte0PointCount: calibration.atmDte0PointCount,
      totalWindowCount: calibration.windowCount,
      evidenceState: calibration.evidenceState,
      blockerCounts,
      policySource: "EXISTING_H1_DTE0_TRANSITION_CALIBRATION_V1" as const,
      thresholdPromoted: false as const,
    },
    boundedOutput: {
      rawMarketRowsOmitted: true as const,
      rawOptionRowsOmitted: true as const,
      rawChainRowsOmitted: true as const,
      rawCanonicalRowsOmitted: true as const,
      maxTopWindows: H1_EOD_BUSINESS_BACKTEST_MAX_TOP,
    },
    safety: {
      readOnly: true as const,
      researchOnly: true as const,
      affectsSelector: false as const,
      affectsTelegram: false as const,
      affectsVerdict: false as const,
      affectsExecution: false as const,
      brokerCallMade: false as const,
      placesOrder: false as const,
      thresholdPromoted: false as const,
      failClosed: true as const,
    },
  };
}

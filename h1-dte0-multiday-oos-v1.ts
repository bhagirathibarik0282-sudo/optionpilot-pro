import type { buildH1Dte0TransitionCalibration } from "./h1-dte0-transition-calibration-v1.js";

export const H1_DTE0_MULTIDAY_OOS_VERSION = "H1_DTE0_MULTIDAY_OOS_V1" as const;
export const H1_DTE0_MIN_USABLE_DAYS_FOR_POLICY_VALIDATION = 4 as const;

type DayCalibration = ReturnType<typeof buildH1Dte0TransitionCalibration>;
type Window = DayCalibration["windows"][number];

export interface H1Dte0MultidayDay {
  tradeDate: string;
  calibration: DayCalibration;
}

function quantile(values: number[], q: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function stats(windows: Window[]) {
  const deltas = windows.map((w) => w.observed.absoluteDeltaChange).filter(Number.isFinite);
  const premiumMoves = windows.map((w) => Math.abs(w.observed.premiumMovePct ?? NaN)).filter(Number.isFinite);
  const gammas = windows.map((w) => w.observed.currentGamma).filter(Number.isFinite);
  const thetaPct = windows.map((w) => w.observed.thetaPctOfPremium ?? NaN).filter(Number.isFinite);
  const iv = windows.map((w) => w.observed.iv).filter(Number.isFinite);
  const meaningful = windows.filter((w) => (w.observed.premiumMovePct ?? -Infinity) >= w.currentPolicy.minPremiumMovePct && w.currentPolicy.gammaPass);
  return {
    windowCount: windows.length,
    meaningfulBuyerWindowCount: meaningful.length,
    absoluteDeltaChange: { p50: quantile(deltas, .5), p75: quantile(deltas, .75), p90: quantile(deltas, .9), p95: quantile(deltas, .95) },
    absolutePremiumMovePct: { p50: quantile(premiumMoves, .5), p75: quantile(premiumMoves, .75), p90: quantile(premiumMoves, .9), p95: quantile(premiumMoves, .95) },
    gamma: { p50: quantile(gammas, .5), p95: quantile(gammas, .95) },
    thetaPctOfPremium: { p50: quantile(thetaPct, .5), p95: quantile(thetaPct, .95) },
    iv: { p50: quantile(iv, .5), p95: quantile(iv, .95) },
  };
}

function fullSessionBoundaryObserved(day: H1Dte0MultidayDay): boolean {
  const request = day.calibration.request;
  const continuity = day.calibration.continuity;
  if (!request || !continuity?.firstObserved || !continuity.lastObserved) return false;
  if (request.tradeDate !== day.tradeDate || request.fromTime !== "09:15" || request.toTime !== "15:30") return false;

  const openMs = Date.parse(`${day.tradeDate}T09:15:00+05:30`);
  const closeMs = Date.parse(`${day.tradeDate}T15:30:00+05:30`);
  const firstObservedMs = Date.parse(continuity.firstObserved);
  const lastObservedMs = Date.parse(continuity.lastObserved);
  const cadenceMs = Math.max(1, Number(continuity.cadenceMinutes) || 3) * 60_000;

  return [openMs, closeMs, firstObservedMs, lastObservedMs].every(Number.isFinite)
    && firstObservedMs <= openMs + cadenceMs
    && lastObservedMs >= closeMs - cadenceMs;
}

export function runH1Dte0MultidayOos(days: H1Dte0MultidayDay[]) {
  const ordered = [...days]
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.tradeDate))
    .sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));
  const usable = ordered.filter((d) => d.calibration.ok && d.calibration.windowCount > 0);
  const validationEligible = usable.filter(fullSessionBoundaryObserved);
  const incompleteSessionDates = usable
    .filter((d) => !fullSessionBoundaryObserved(d))
    .map((d) => d.tradeDate);
  const blockers: string[] = [];
  if (validationEligible.length < H1_DTE0_MIN_USABLE_DAYS_FOR_POLICY_VALIDATION) blockers.push("INSUFFICIENT_DTE0_DAYS_REQUIRE_4");

  const cut = validationEligible.length >= H1_DTE0_MIN_USABLE_DAYS_FOR_POLICY_VALIDATION
    ? Math.max(1, Math.floor(validationEligible.length * .7))
    : validationEligible.length;
  const calibrationDays = validationEligible.slice(0, cut);
  const oosDays = validationEligible.slice(cut);
  const calibrationWindows = calibrationDays.flatMap((d) => d.calibration.windows);
  const oosWindows = oosDays.flatMap((d) => d.calibration.windows);
  const calibrationStats = stats(calibrationWindows);
  const oosStats = stats(oosWindows);
  const candidateDeltaP95 = validationEligible.length >= H1_DTE0_MIN_USABLE_DAYS_FOR_POLICY_VALIDATION
    ? calibrationStats.absoluteDeltaChange.p95
    : null;

  let oosDeltaPassRateAtCandidate: number | null = null;
  if (candidateDeltaP95 != null && oosWindows.length) {
    const meaningfulOos = oosWindows.filter((w) => (w.observed.premiumMovePct ?? -Infinity) >= w.currentPolicy.minPremiumMovePct && w.currentPolicy.gammaPass);
    oosDeltaPassRateAtCandidate = meaningfulOos.length
      ? meaningfulOos.filter((w) => w.observed.absoluteDeltaChange >= candidateDeltaP95).length / meaningfulOos.length
      : null;
  }

  const missingUsableDte0Days = Math.max(0, H1_DTE0_MIN_USABLE_DAYS_FOR_POLICY_VALIDATION - validationEligible.length);

  return {
    ok: blockers.length === 0,
    mode: H1_DTE0_MULTIDAY_OOS_VERSION,
    productionImpact: "NONE" as const,
    semantics: "HISTORICAL_REPLAY_RESEARCH_ONLY" as const,
    requestedDayCount: ordered.length,
    usableDayCount: usable.length,
    validationEligibleDayCount: validationEligible.length,
    readiness: {
      state: missingUsableDte0Days === 0 ? "READY_FOR_POLICY_VALIDATION" as const : "WAITING_FOR_MORE_DTE0_DAYS" as const,
      usableDte0DayCount: validationEligible.length,
      observedUsableDte0DayCount: usable.length,
      completedSessionDte0DayCount: validationEligible.length,
      minimumRequiredDte0Days: H1_DTE0_MIN_USABLE_DAYS_FOR_POLICY_VALIDATION,
      missingUsableDte0Days,
      incompleteSessionDates,
      completionRule: "FULL_0915_1530_SESSION_BOUNDARIES_OBSERVED_WITHIN_ONE_REPLAY_CADENCE" as const,
      policyPromotionAuthority: "NONE" as const,
      selectorAuthority: "NONE" as const,
      telegramAuthority: "NONE" as const,
      executionAuthority: "NONE" as const,
    },
    calibrationDates: calibrationDays.map((d) => d.tradeDate),
    oosDates: oosDays.map((d) => d.tradeDate),
    candidateDeltaP95,
    calibration: calibrationStats,
    oos: oosStats,
    oosDeltaPassRateAtCandidate,
    blockers,
    safety: {
      readOnly: true,
      affectsSelector: false,
      affectsTelegram: false,
      affectsVerdict: false,
      affectsExecution: false,
      thresholdPromoted: false,
      dte0ThresholdInvented: false,
      incompleteSessionPromoted: false,
      failClosed: true,
    },
  };
}

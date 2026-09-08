import type { buildH1Dte0TransitionCalibration } from "./h1-dte0-transition-calibration-v1.js";

export const H1_DTE0_MULTIDAY_OOS_VERSION = "H1_DTE0_MULTIDAY_OOS_V1" as const;

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

export function runH1Dte0MultidayOos(days: H1Dte0MultidayDay[]) {
  const ordered = [...days]
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.tradeDate))
    .sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));
  const usable = ordered.filter((d) => d.calibration.ok && d.calibration.windowCount > 0);
  const blockers: string[] = [];
  if (usable.length < 4) blockers.push("INSUFFICIENT_DTE0_DAYS_REQUIRE_4");

  const cut = usable.length >= 4 ? Math.max(1, Math.floor(usable.length * .7)) : usable.length;
  const calibrationDays = usable.slice(0, cut);
  const oosDays = usable.slice(cut);
  const calibrationWindows = calibrationDays.flatMap((d) => d.calibration.windows);
  const oosWindows = oosDays.flatMap((d) => d.calibration.windows);
  const calibrationStats = stats(calibrationWindows);
  const oosStats = stats(oosWindows);
  const candidateDeltaP95 = usable.length >= 4 ? calibrationStats.absoluteDeltaChange.p95 : null;

  let oosDeltaPassRateAtCandidate: number | null = null;
  if (candidateDeltaP95 != null && oosWindows.length) {
    const meaningfulOos = oosWindows.filter((w) => (w.observed.premiumMovePct ?? -Infinity) >= w.currentPolicy.minPremiumMovePct && w.currentPolicy.gammaPass);
    oosDeltaPassRateAtCandidate = meaningfulOos.length
      ? meaningfulOos.filter((w) => w.observed.absoluteDeltaChange >= candidateDeltaP95).length / meaningfulOos.length
      : null;
  }

  return {
    ok: blockers.length === 0,
    mode: H1_DTE0_MULTIDAY_OOS_VERSION,
    productionImpact: "NONE" as const,
    semantics: "HISTORICAL_REPLAY_RESEARCH_ONLY" as const,
    requestedDayCount: ordered.length,
    usableDayCount: usable.length,
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
      failClosed: true,
    },
  };
}

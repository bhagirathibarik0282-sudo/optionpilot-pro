import type { H1ReplayHttpResult, H1ReplayRequest } from "./h1-replay-http.js";
import { H1_SELECTOR_SHADOW_PROFILE_V1 } from "./h1-selector-shadow-profile.js";

export const H1_DTE0_TRANSITION_CALIBRATION_VERSION = "H1_DTE0_TRANSITION_CALIBRATION_V1" as const;

function n(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function s(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function pctChange(previous: number, current: number): number | null {
  if (!Number.isFinite(previous) || !Number.isFinite(current) || previous <= 0) return null;
  return ((current - previous) / previous) * 100;
}

type ReplayOption = Record<string, unknown>;

type Point = {
  minuteBucket: string;
  side: "CE" | "PE";
  strike: number;
  premiumLtp: number;
  delta: number;
  gamma: number;
  theta: number;
  iv: number;
  liquidityStatus: string | null;
  validationStatus: string | null;
};

function toPoint(row: ReplayOption): Point | null {
  const minuteBucket = s(row.minute_bucket);
  const side = s(row.option_type);
  const strike = n(row.strike);
  const premiumLtp = n(row.ltp);
  const delta = n(row.delta);
  const gamma = n(row.gamma);
  const theta = n(row.theta);
  const iv = n(row.iv);
  const dte = n(row.dte);
  const atmOffset = n(row.atm_offset);
  const expiryBucket = s(row.expiry_bucket);
  if (!minuteBucket || (side !== "CE" && side !== "PE")) return null;
  if (dte !== 0 || atmOffset !== 0 || expiryBucket !== "Current Expiry") return null;
  if ([strike, premiumLtp, delta, gamma, theta, iv].some((v) => v === null)) return null;
  return {
    minuteBucket,
    side,
    strike: strike as number,
    premiumLtp: premiumLtp as number,
    delta: delta as number,
    gamma: gamma as number,
    theta: theta as number,
    iv: iv as number,
    liquidityStatus: s(row.liquidity_status),
    validationStatus: s(row.validation_status),
  };
}

export function buildH1Dte0TransitionCalibration(request: H1ReplayRequest, replay: H1ReplayHttpResult) {
  const policy = H1_SELECTOR_SHADOW_PROFILE_V1;
  const points = (replay.options ?? []).map(toPoint).filter((x): x is Point => x !== null);
  const bySide = new Map<"CE" | "PE", Point[]>();
  bySide.set("CE", points.filter((p) => p.side === "CE").sort((a, b) => Date.parse(a.minuteBucket) - Date.parse(b.minuteBucket)));
  bySide.set("PE", points.filter((p) => p.side === "PE").sort((a, b) => Date.parse(a.minuteBucket) - Date.parse(b.minuteBucket)));

  const windows = (["CE", "PE"] as const).flatMap((side) => {
    const series = bySide.get(side) ?? [];
    const out = [];
    for (let i = 1; i < series.length; i += 1) {
      const previous = series[i - 1];
      const current = series[i];
      if (previous.strike !== current.strike) continue;
      const premiumMovePct = pctChange(previous.premiumLtp, current.premiumLtp);
      const absoluteDeltaChange = Math.abs(current.delta - previous.delta);
      const currentGamma = current.gamma;
      const thetaPctOfPremium = current.premiumLtp > 0 ? Math.abs(current.theta) / current.premiumLtp * 100 : null;
      const premiumPass = premiumMovePct != null && premiumMovePct >= policy.premiumPolicy.minPremiumMovePct;
      const deltaPass = absoluteDeltaChange >= policy.premiumPolicy.minAbsoluteDeltaChange;
      const gammaPass = currentGamma >= policy.premiumPolicy.minCurrentGamma;
      const thetaPass = thetaPctOfPremium != null && thetaPctOfPremium <= policy.burdenPolicy.maxAbsThetaPctOfPremium;
      const ivPass = current.iv >= policy.burdenPolicy.minIv && current.iv <= policy.burdenPolicy.maxIv;
      out.push({
        side,
        strike: current.strike,
        from: previous.minuteBucket,
        to: current.minuteBucket,
        observed: {
          premiumLtpFrom: previous.premiumLtp,
          premiumLtpTo: current.premiumLtp,
          premiumMovePct,
          deltaFrom: previous.delta,
          deltaTo: current.delta,
          absoluteDeltaChange,
          currentGamma,
          theta: current.theta,
          thetaPctOfPremium,
          iv: current.iv,
          liquidityStatus: current.liquidityStatus,
          validationStatus: current.validationStatus,
        },
        currentPolicy: {
          minPremiumMovePct: policy.premiumPolicy.minPremiumMovePct,
          minAbsoluteDeltaChange: policy.premiumPolicy.minAbsoluteDeltaChange,
          minCurrentGamma: policy.premiumPolicy.minCurrentGamma,
          maxAbsThetaPctOfPremium: policy.burdenPolicy.maxAbsThetaPctOfPremium,
          minIv: policy.burdenPolicy.minIv,
          maxIv: policy.burdenPolicy.maxIv,
          premiumPass,
          deltaPass,
          gammaPass,
          deltaGammaPass: deltaPass && gammaPass,
          thetaPass,
          ivPass,
          thetaIvPass: thetaPass && ivPass,
        },
        researchOnly: true,
        thresholdPromoted: false,
      });
    }
    return out;
  });

  return {
    ok: replay.ok,
    mode: H1_DTE0_TRANSITION_CALIBRATION_VERSION,
    productionImpact: "NONE" as const,
    semantics: "HISTORICAL_REPLAY_RESEARCH_ONLY" as const,
    request,
    replayCounts: replay.counts ?? null,
    continuity: replay.continuity ?? null,
    atmDte0PointCount: points.length,
    windowCount: windows.length,
    windows,
    evidenceState: windows.length > 0 ? "OBSERVATIONS_AVAILABLE_NO_THRESHOLD_PROMOTION" : "INSUFFICIENT_DTE0_REPLAY_OBSERVATIONS",
    safety: {
      readOnly: true,
      affectsSelector: false,
      affectsTelegram: false,
      affectsVerdict: false,
      affectsExecution: false,
      brokerCallMade: false,
      placesOrder: false,
      thresholdPromoted: false,
      dte0ThresholdInvented: false,
      failClosed: true,
    },
  };
}

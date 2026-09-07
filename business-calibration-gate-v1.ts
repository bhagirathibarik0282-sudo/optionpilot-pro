import type { BusinessForwardKpiResult } from "./business-forward-kpi-v1.js";
import type { OosCalibrationResult } from "./h1-oos-calibration.js";

export const BUSINESS_CALIBRATION_GATE_V1 = "BUSINESS_CALIBRATION_GATE_V1" as const;

export interface BusinessCalibrationGate {
  version: typeof BUSINESS_CALIBRATION_GATE_V1;
  ready: boolean;
  state: "CALIBRATED" | "FORWARD_PROOF_BUILDING" | "WAIT";
  forward: {
    sampleCandidateCount: number;
    completedWindowCount: number;
    selectedTerminalReturnPct: number | null;
    selectionRegretPct: number | null;
  };
  oos: {
    status: OosCalibrationResult["status"] | "NOT_PROVIDED";
    inSampleWinRate: number | null;
    outOfSampleWinRate: number | null;
    degradationPctPoints: number | null;
  };
  blockers: string[];
  probabilityClaimAllowed: false;
  productionWeightingAllowed: false;
  affectsStars: false;
  affectsCandidateAuthority: false;
  affectsTelegram: false;
  affectsExecution: false;
  createsOrders: false;
}

export function buildBusinessCalibrationGate(input: {
  forwardKpis?: BusinessForwardKpiResult | null;
  oos?: OosCalibrationResult | null;
}): BusinessCalibrationGate {
  const k = input?.forwardKpis ?? null;
  const o = input?.oos ?? null;
  const blockers: string[] = [];
  if (!k?.ready) blockers.push(...(k?.blockers?.length ? k.blockers : ["FORWARD_KPI_PROOF_REQUIRED"]));
  if (!o) blockers.push("OOS_CALIBRATION_REQUIRED");
  else if (!o.regimeStrengthMayBeCalibrated) blockers.push(...(o.blockers.length ? o.blockers : ["OOS_CALIBRATION_NOT_READY"]));

  const ready = Boolean(k?.ready && o?.regimeStrengthMayBeCalibrated);
  const state: BusinessCalibrationGate["state"] = ready
    ? "CALIBRATED"
    : k?.ready
      ? "FORWARD_PROOF_BUILDING"
      : "WAIT";

  return {
    version: BUSINESS_CALIBRATION_GATE_V1,
    ready,
    state,
    forward: {
      sampleCandidateCount: k?.sampleCandidateCount ?? 0,
      completedWindowCount: k?.completedWindowCount ?? 0,
      selectedTerminalReturnPct: k?.selectedTerminalReturnPct ?? null,
      selectionRegretPct: k?.selectionRegretPct ?? null,
    },
    oos: {
      status: o?.status ?? "NOT_PROVIDED",
      inSampleWinRate: o?.inSampleWinRate ?? null,
      outOfSampleWinRate: o?.outOfSampleWinRate ?? null,
      degradationPctPoints: o?.degradationPctPoints ?? null,
    },
    blockers: [...new Set(blockers)],
    probabilityClaimAllowed: false,
    productionWeightingAllowed: false,
    affectsStars: false,
    affectsCandidateAuthority: false,
    affectsTelegram: false,
    affectsExecution: false,
    createsOrders: false,
  };
}

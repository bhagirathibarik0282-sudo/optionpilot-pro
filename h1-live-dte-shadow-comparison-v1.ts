import { collectH1LiveResponseMetrics } from "./h1-live-selector-registry.js";
import { evaluateH1DteAwareShadowThreshold } from "./h1-dte-aware-shadow-threshold-v1.js";

export interface H1LiveDteShadowComparisonContract {
  key: string;
  symbol: string;
  expiryDate: string;
  dte: number;
  strike: number;
  side: string;
  observedAbsoluteDeltaChange: number;
  universalThreshold: 0.03;
  universalPass: boolean;
  shadowBucket: string;
  shadowThreshold: number | null;
  shadowPass: boolean;
  shadowBlocker: string | null;
  recoveredByShadow: boolean;
}

export interface H1LiveDteShadowComparisonResult {
  ok: true;
  mode: "READ_ONLY_H1_LIVE_DTE_SHADOW_COMPARISON_V1";
  productionImpact: "NONE";
  semantics: "LIVE_EXACT_READ_ONLY_SHADOW_COMPARISON";
  asOf: string;
  totalContracts: number;
  universalPassCount: number;
  shadowPassCount: number;
  recoveredByShadowCount: number;
  contracts: H1LiveDteShadowComparisonContract[];
  affectsSelector: false;
  affectsTelegram: false;
  affectsExecution: false;
  failClosed: true;
}

export function buildH1LiveDteShadowComparison(nowIso = new Date().toISOString()): H1LiveDteShadowComparisonResult {
  const metrics = collectH1LiveResponseMetrics(nowIso);
  const contracts = metrics.map((row) => {
    const dte = row.identity.dte;
    const delta = Math.abs(row.metrics.absoluteDeltaChange);
    const shadow = evaluateH1DteAwareShadowThreshold({ dte, absoluteDeltaChange: delta });
    const universalPass = delta >= 0.03;
    return {
      key: row.key,
      symbol: row.identity.symbol,
      expiryDate: row.identity.expiryDate,
      dte,
      strike: row.identity.strike,
      side: row.identity.side,
      observedAbsoluteDeltaChange: delta,
      universalThreshold: 0.03 as const,
      universalPass,
      shadowBucket: shadow.bucket,
      shadowThreshold: shadow.threshold,
      shadowPass: shadow.pass,
      shadowBlocker: shadow.blocker,
      recoveredByShadow: !universalPass && shadow.pass,
    };
  });

  return {
    ok: true,
    mode: "READ_ONLY_H1_LIVE_DTE_SHADOW_COMPARISON_V1",
    productionImpact: "NONE",
    semantics: "LIVE_EXACT_READ_ONLY_SHADOW_COMPARISON",
    asOf: nowIso,
    totalContracts: contracts.length,
    universalPassCount: contracts.filter((x) => x.universalPass).length,
    shadowPassCount: contracts.filter((x) => x.shadowPass).length,
    recoveredByShadowCount: contracts.filter((x) => x.recoveredByShadow).length,
    contracts,
    affectsSelector: false,
    affectsTelegram: false,
    affectsExecution: false,
    failClosed: true,
  };
}

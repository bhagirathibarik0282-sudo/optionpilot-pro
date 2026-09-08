import { collectH1LiveGateEvidenceAudit, collectH1LiveSelectorDecisions, getH1LiveSelectorRegistrySize } from "./h1-live-selector-registry.js";
import { evaluateH1DteAwareShadowThreshold } from "./h1-dte-aware-shadow-threshold-v1.js";

export interface CanonicalSelectorDiagnosticQuery {
  symbol?: string | null;
  nowIso?: string | null;
}

export function runCanonicalSelectorDiagnosticHttp(query: CanonicalSelectorDiagnosticQuery): { status: 200 | 400; body: Record<string, unknown> } {
  const symbol = String(query.symbol ?? "NIFTY").trim().toUpperCase();
  if (symbol !== "NIFTY" && symbol !== "SENSEX") {
    return {
      status: 400,
      body: {
        ok: false,
        mode: "READ_ONLY_CANONICAL_SELECTOR_DIAGNOSTIC_V4",
        productionImpact: "NONE",
        reason: "FORWARD_TEST_SYMBOL_NOT_SUPPORTED",
        allowed: ["NIFTY", "SENSEX"],
        executionEnabled: false,
      },
    };
  }

  const nowIso = String(query.nowIso ?? new Date().toISOString());
  if (!Number.isFinite(Date.parse(nowIso))) {
    return {
      status: 400,
      body: {
        ok: false,
        mode: "READ_ONLY_CANONICAL_SELECTOR_DIAGNOSTIC_V4",
        productionImpact: "NONE",
        reason: "INVALID_NOW_ISO",
        executionEnabled: false,
      },
    };
  }

  const registrySizeBeforeCollect = getH1LiveSelectorRegistrySize();
  const pipeline = collectH1LiveSelectorDecisions(nowIso);
  const gateEvidence = collectH1LiveGateEvidenceAudit(nowIso).filter((entry) => entry.identity.symbol === symbol);
  const symbolDecisions = pipeline.decisions.filter((decision) => decision.symbol === symbol);
  const symbolEvaluations = pipeline.evaluations.filter((evaluation) => evaluation.candidate.symbol === symbol);
  const selects = symbolDecisions.filter((decision) => decision.decision === "SELECT");
  const blocks = symbolDecisions.filter((decision) => decision.decision === "BLOCK");
  const reasonCodes = [...new Set(blocks.flatMap((decision) => decision.reasonCodes ?? []))];

  const dte0Calibration = gateEvidence
    .filter((entry) => entry.identity.dte >= 0 && entry.identity.dte <= 1)
    .map((entry) => {
      const pdg = entry.policyDiagnostics?.premiumDeltaGamma ?? null;
      const tiv = entry.policyDiagnostics?.thetaIv ?? null;
      const absoluteDeltaChange = entry.responseMetrics?.absoluteDeltaChange;
      const shadowDelta = Number.isFinite(absoluteDeltaChange)
        ? evaluateH1DteAwareShadowThreshold({ dte: entry.identity.dte, absoluteDeltaChange: absoluteDeltaChange as number })
        : null;

      return {
        key: entry.key,
        identity: entry.identity,
        ageMs: entry.ageMs,
        observed: {
          premiumMovePct: entry.responseMetrics?.premiumMovePct ?? null,
          absoluteDeltaChange: absoluteDeltaChange ?? null,
          currentGamma: entry.responseMetrics?.currentGamma ?? null,
          theta: tiv?.theta ?? null,
          iv: tiv?.iv ?? null,
          premiumLtp: tiv?.premiumLtp ?? entry.identity.premiumLtp,
          thetaPctOfPremium: tiv?.thetaPctOfPremium ?? null,
        },
        currentPolicy: pdg && tiv ? {
          minPremiumMovePct: pdg.minPremiumMovePct,
          minAbsoluteDeltaChange: pdg.minAbsoluteDeltaChange,
          minCurrentGamma: pdg.minCurrentGamma,
          maxAbsThetaPctOfPremium: tiv.maxAbsThetaPctOfPremium,
          minIv: tiv.minIv,
          maxIv: tiv.maxIv,
          premiumPass: pdg.premiumPass,
          deltaPass: pdg.deltaPass,
          gammaPass: pdg.gammaPass,
          deltaGammaPass: pdg.deltaGammaPass,
          thetaPass: tiv.thetaPass,
          ivPass: tiv.ivPass,
          thetaIvPass: tiv.thetaIvPass,
          reasonCodes: [...new Set([...pdg.reasonCodes, ...tiv.reasonCodes])],
        } : null,
        shadowDeltaCalibration: shadowDelta,
        calibrationState: shadowDelta?.threshold == null
          ? "DTE0_1_RESEARCH_EVIDENCE_INSUFFICIENT_NO_THRESHOLD_PROMOTION"
          : shadowDelta.pass
            ? "SHADOW_DELTA_PASS"
            : "SHADOW_DELTA_BLOCK",
      };
    });

  return {
    status: 200,
    body: {
      ok: true,
      mode: "READ_ONLY_CANONICAL_SELECTOR_DIAGNOSTIC_V4",
      productionImpact: "NONE",
      symbol,
      nowIso,
      registrySizeBeforeCollect,
      eligibleForLiveH1Marking: pipeline.eligibleForLiveH1Marking,
      assembledCount: pipeline.assembledCount,
      blockedAtAssemblyCount: pipeline.blockedCount,
      rejectedAtAssembly: pipeline.rejected,
      producerRejected: pipeline.producerRejected,
      symbolDecisionCount: symbolDecisions.length,
      selectCount: selects.length,
      blockCount: blocks.length,
      reasonCodes,
      decisions: symbolDecisions,
      evaluations: symbolEvaluations,
      gateEvidence,
      dte0Calibration,
      ready: selects.length > 0,
      blocker: selects.length > 0
        ? null
        : pipeline.assembledCount === 0 && pipeline.blockedCount === 0
          ? "NO_FRESH_LIVE_GATE_PACKETS_IN_REGISTRY"
          : pipeline.blockedCount > 0
            ? "LIVE_GATE_PACKET_ASSEMBLY_BLOCKED"
            : blocks.length > 0
              ? "EXECUTION_SELECTOR_GATES_BLOCKED"
              : "NO_SYMBOL_SELECTOR_DECISION",
      safety: {
        readOnly: true,
        selectorChanged: false,
        selectorReranked: false,
        telegramPayloadChanged: false,
        candidateAuthorityChanged: false,
        executionEnabled: false,
        brokerCallMade: false,
        placesOrder: false,
        thresholdPromoted: false,
        dte0ThresholdInvented: false,
        failClosed: true,
      },
    },
  };
}

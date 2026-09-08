import { collectH1LiveGateEvidenceAudit, collectH1LiveSelectorDecisions, getH1LiveSelectorRegistrySize } from "./h1-live-selector-registry.js";

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
        mode: "READ_ONLY_CANONICAL_SELECTOR_DIAGNOSTIC_V2",
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
        mode: "READ_ONLY_CANONICAL_SELECTOR_DIAGNOSTIC_V2",
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

  return {
    status: 200,
    body: {
      ok: true,
      mode: "READ_ONLY_CANONICAL_SELECTOR_DIAGNOSTIC_V2",
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
        failClosed: true,
      },
    },
  };
}

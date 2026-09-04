import type { H1ContextFusedLowNoiseCommentary } from "./h1-context-fused-low-noise-commentary.js";

export type H1DryRunEmissionAction = "DRY_RUN_EMIT_ELIGIBLE" | "DUPLICATE_SUPPRESSED" | "BLOCKED";

export interface H1DryRunEmissionPreview {
  version: "H1_COMMENTARY_DRY_RUN_EMISSION_PREVIEW_V1";
  ready: boolean;
  action: H1DryRunEmissionAction;
  semanticKey: string | null;
  text: string | null;
  blockers: string[];
  dryRun: true;
  networkSendAttempted: false;
  telegramSendAllowed: false;
  productionImpact: "NONE";
  affectsTelegram: false;
  affectsVerdict: false;
  affectsExecution: false;
  grantsPromotionAuthority: false;
  failClosed: true;
  semantics: "SEMANTIC_DEDUP_DRY_RUN_ONLY_NO_TRANSPORT";
}

export interface H1DryRunReplayAcceptance {
  version: "H1_COMMENTARY_DRY_RUN_REPLAY_ACCEPTANCE_V1";
  events: H1DryRunEmissionPreview[];
  eligibleEmitCount: number;
  duplicateSuppressedCount: number;
  blockedCount: number;
  networkSendAttemptCount: 0;
  productionImpact: "NONE";
  affectsTelegram: false;
  affectsVerdict: false;
  affectsExecution: false;
  failClosed: true;
}

function unsafe(x: H1ContextFusedLowNoiseCommentary | null): boolean {
  return !x || x.productionImpact !== "NONE" || x.telegramSendAllowed || x.affectsTelegram ||
    x.affectsVerdict || x.affectsExecution || x.grantsPromotionAuthority || !x.failClosed;
}

function blocked(blockers: string[]): H1DryRunEmissionPreview {
  return {
    version: "H1_COMMENTARY_DRY_RUN_EMISSION_PREVIEW_V1",
    ready: false,
    action: "BLOCKED",
    semanticKey: null,
    text: null,
    blockers: [...new Set(blockers)],
    dryRun: true,
    networkSendAttempted: false,
    telegramSendAllowed: false,
    productionImpact: "NONE",
    affectsTelegram: false,
    affectsVerdict: false,
    affectsExecution: false,
    grantsPromotionAuthority: false,
    failClosed: true,
    semantics: "SEMANTIC_DEDUP_DRY_RUN_ONLY_NO_TRANSPORT",
  };
}

export function previewH1ContextCommentaryEmission(
  previousSemanticKey: string | null,
  current: H1ContextFusedLowNoiseCommentary | null,
  options: { dryRun?: boolean } = {},
): H1DryRunEmissionPreview {
  if (options.dryRun === false) return blocked(["DRY_RUN_REQUIRED"]);
  if (unsafe(current)) return blocked(["COMMENTARY_SAFETY_CONTRACT_INVALID"]);
  if (!current!.ready) return blocked(["COMMENTARY_NOT_READY", ...current!.blockers]);
  if (!current!.semanticKey.trim()) return blocked(["EMPTY_SEMANTIC_KEY"]);

  const duplicate = previousSemanticKey === current!.semanticKey;
  return {
    version: "H1_COMMENTARY_DRY_RUN_EMISSION_PREVIEW_V1",
    ready: true,
    action: duplicate ? "DUPLICATE_SUPPRESSED" : "DRY_RUN_EMIT_ELIGIBLE",
    semanticKey: current!.semanticKey,
    text: duplicate ? null : current!.text,
    blockers: [],
    dryRun: true,
    networkSendAttempted: false,
    telegramSendAllowed: false,
    productionImpact: "NONE",
    affectsTelegram: false,
    affectsVerdict: false,
    affectsExecution: false,
    grantsPromotionAuthority: false,
    failClosed: true,
    semantics: "SEMANTIC_DEDUP_DRY_RUN_ONLY_NO_TRANSPORT",
  };
}

export function replayH1ContextCommentaryDryRun(
  sequence: H1ContextFusedLowNoiseCommentary[],
): H1DryRunReplayAcceptance {
  const events: H1DryRunEmissionPreview[] = [];
  let previousSemanticKey: string | null = null;
  for (const current of sequence) {
    const event = previewH1ContextCommentaryEmission(previousSemanticKey, current, { dryRun: true });
    events.push(event);
    if (event.ready && event.action === "DRY_RUN_EMIT_ELIGIBLE") previousSemanticKey = event.semanticKey;
  }
  return {
    version: "H1_COMMENTARY_DRY_RUN_REPLAY_ACCEPTANCE_V1",
    events,
    eligibleEmitCount: events.filter((x) => x.action === "DRY_RUN_EMIT_ELIGIBLE").length,
    duplicateSuppressedCount: events.filter((x) => x.action === "DUPLICATE_SUPPRESSED").length,
    blockedCount: events.filter((x) => x.action === "BLOCKED").length,
    networkSendAttemptCount: 0,
    productionImpact: "NONE",
    affectsTelegram: false,
    affectsVerdict: false,
    affectsExecution: false,
    failClosed: true,
  };
}

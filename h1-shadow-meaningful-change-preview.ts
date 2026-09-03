import type { H1ShadowEvidenceReadinessResult } from "./h1-shadow-evidence-readiness-gate.js";
import type { H1LiveSelectorPipelineResult } from "./h1-live-selector-pipeline.js";
import type { H1ForwardCandidateDecisionInput } from "./h1-forward-candidate-decision-binding.js";

export type H1MeaningfulChangeKind = "INITIAL_STATE" | "MATERIAL_CHANGE";

export interface H1ShadowMeaningfulDecisionView {
  key: string;
  decision: "SELECT" | "BLOCK";
  reasonCodes: string[];
  gates: Record<string, boolean | null>;
  selectorVersion: string | null;
}

export interface H1ShadowMeaningfulChangePreview {
  version: "H1_SHADOW_MEANINGFUL_CHANGE_PREVIEW_V1";
  ready: boolean;
  meaningfulChange: boolean;
  kind: H1MeaningfulChangeKind | null;
  observedAt: string | null;
  decisions: H1ShadowMeaningfulDecisionView[];
  added: string[];
  removed: string[];
  changed: string[];
  blockers: string[];
  productionImpact: "NONE";
  telegramSendAllowed: false;
  affectsTelegram: false;
  affectsVerdict: false;
  affectsExecution: false;
  grantsPromotionAuthority: false;
  failClosed: true;
  semantics: "READINESS_GATED_SELECTOR_CHANGE_PREVIEW_ONLY";
}

const VERSION = "H1_SHADOW_MEANINGFUL_CHANGE_PREVIEW_V1" as const;
const SEMANTICS = "READINESS_GATED_SELECTOR_CHANGE_PREVIEW_ONLY" as const;

function keyOf(x: H1ForwardCandidateDecisionInput): string {
  return `${x.symbol}|${x.expiry}|${x.strike}|${x.side}`;
}

function normalizeDecision(x: H1ForwardCandidateDecisionInput): H1ShadowMeaningfulDecisionView {
  const gates = Object.fromEntries(Object.entries(x.gates ?? {}).sort(([a], [b]) => a.localeCompare(b)));
  return {
    key: keyOf(x),
    decision: x.decision,
    reasonCodes: [...new Set(x.reasonCodes ?? [])].sort(),
    gates,
    selectorVersion: x.selectorVersion ?? null,
  };
}

function signature(x: H1ShadowMeaningfulDecisionView): string {
  return JSON.stringify(x);
}

function base(blockers: string[]): H1ShadowMeaningfulChangePreview {
  return {
    version: VERSION,
    ready: false,
    meaningfulChange: false,
    kind: null,
    observedAt: null,
    decisions: [],
    added: [],
    removed: [],
    changed: [],
    blockers: [...new Set(blockers)],
    productionImpact: "NONE",
    telegramSendAllowed: false,
    affectsTelegram: false,
    affectsVerdict: false,
    affectsExecution: false,
    grantsPromotionAuthority: false,
    failClosed: true,
    semantics: SEMANTICS,
  };
}

/**
 * Stateful research-shadow preview boundary. It consumes only a readiness PASS
 * plus a clean deterministic selector result. Identical selector state is
 * suppressed, so periodic polling cannot manufacture repeated "meaningful"
 * messages. This class never sends Telegram or grants any production authority.
 */
export class H1ShadowMeaningfulChangePreviewEngine {
  private previous = new Map<string, H1ShadowMeaningfulDecisionView>();
  private initialized = false;

  evaluate(
    readiness: H1ShadowEvidenceReadinessResult | null,
    pipeline: H1LiveSelectorPipelineResult | null,
    nowIso: string,
  ): H1ShadowMeaningfulChangePreview {
    const blockers: string[] = [];
    const now = Date.parse(nowIso);
    if (!Number.isFinite(now)) blockers.push("INVALID_PREVIEW_TIME");
    if (!readiness) blockers.push("MISSING_SHADOW_READINESS");
    if (!pipeline) blockers.push("MISSING_SELECTOR_PIPELINE_RESULT");

    if (readiness) {
      if (!readiness.readyForNextShadowStage || readiness.blockers.length > 0) blockers.push("SHADOW_READINESS_NOT_PASSED");
      if (readiness.productionImpact !== "NONE" || readiness.affectsTelegram || readiness.affectsVerdict || readiness.affectsExecution || readiness.grantsPromotionAuthority || !readiness.failClosed) {
        blockers.push("READINESS_AUTHORITY_CONTRACT_VIOLATION");
      }
      const evidenceMs = readiness.newestExactReadyTimestamp ? Date.parse(readiness.newestExactReadyTimestamp) : NaN;
      if (!Number.isFinite(evidenceMs)) blockers.push("MISSING_EXACT_READY_TIMESTAMP");
      else if (Number.isFinite(now) && evidenceMs > now) blockers.push("FUTURE_EXACT_READY_TIMESTAMP");
    }

    if (pipeline) {
      if (!pipeline.eligibleForLiveH1Marking) blockers.push("SELECTOR_PIPELINE_NOT_ELIGIBLE");
      if (pipeline.rejected.length > 0 || pipeline.producerRejected.length > 0 || pipeline.blockedCount > 0) blockers.push("SELECTOR_PIPELINE_HAS_REJECTIONS");
      if (!pipeline.failClosed) blockers.push("SELECTOR_PIPELINE_NOT_FAIL_CLOSED");
    }

    if (blockers.length > 0 || !readiness || !pipeline) return base(blockers);

    const normalized = pipeline.decisions.map(normalizeDecision).sort((a, b) => a.key.localeCompare(b.key));
    const current = new Map(normalized.map((x) => [x.key, x]));
    const added = normalized.filter((x) => !this.previous.has(x.key)).map((x) => x.key);
    const removed = [...this.previous.keys()].filter((key) => !current.has(key)).sort();
    const changed = normalized
      .filter((x) => this.previous.has(x.key) && signature(this.previous.get(x.key)!) !== signature(x))
      .map((x) => x.key);

    const kind: H1MeaningfulChangeKind = this.initialized ? "MATERIAL_CHANGE" : "INITIAL_STATE";
    const meaningfulChange = !this.initialized || added.length > 0 || removed.length > 0 || changed.length > 0;

    this.previous = current;
    this.initialized = true;

    return {
      ...base([]),
      ready: true,
      meaningfulChange,
      kind: meaningfulChange ? kind : null,
      observedAt: nowIso,
      decisions: normalized,
      added,
      removed,
      changed,
      blockers: [],
    };
  }

  clear(): void {
    this.previous.clear();
    this.initialized = false;
  }
}

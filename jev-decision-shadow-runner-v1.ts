import { dbLoadRecent, dbQuerySafe } from "./db.js";
import type { LiveGateEvidencePacket } from "./h1-live-gate-evidence-assembler.js";
import { H1_LIVE_GATE_EVIDENCE_PERSIST_KIND } from "./h1-live-selector-registry.js";
import {
  buildJevDecisionShadowPlan,
  buildJevDecisionShadowSampleFromLivePacket,
  callJevDecisionShadow,
  JEV_DECISION_SHADOW_VERSION,
  JEV_PINNED_MODEL,
  type JevDecisionShadowApiResponse,
} from "./jev-decision-shadow-v1.js";

export const JEV_DECISION_SHADOW_RESULT_PERSIST_KIND = "JEV_DECISION_SHADOW_RESULT_V1" as const;

export interface JevDecisionShadowRunInput {
  limit?: number;
  symbol?: "NIFTY" | "SENSEX" | "BANKNIFTY" | null;
}

export interface JevDecisionShadowRunnerDeps {
  loadRecent: <T>(kind: string, limit: number) => Promise<T[]>;
  persistResult: (payload: unknown) => Promise<boolean>;
  fetchImpl: typeof fetch;
  apiKey: string;
}

export interface JevDecisionShadowRunResult {
  ok: boolean;
  version: typeof JEV_DECISION_SHADOW_VERSION;
  mode: "RESEARCH_SHADOW_ONLY";
  model: typeof JEV_PINNED_MODEL;
  sourceKind: typeof H1_LIVE_GATE_EVIDENCE_PERSIST_KIND;
  resultPersistKind: typeof JEV_DECISION_SHADOW_RESULT_PERSIST_KIND;
  requestedLimit: number;
  sourceRowsScanned: number;
  sampleCount: number;
  skippedCount: number;
  skipped: Array<{ sourceIndex: number; blockers: string[] }>;
  baseline: ReturnType<typeof buildJevDecisionShadowPlan>["baseline"];
  answers: Record<string, unknown> | null;
  usage: JevDecisionShadowApiResponse["usage"] | null;
  persisted: boolean;
  blocker: string | null;
  safety: {
    affectsVerdict: false;
    affectsCandidate: false;
    affectsTelegram: false;
    affectsExecution: false;
    createsOrders: false;
    aiMayOverride: false;
    futureOutcomeIncluded: false;
  };
}

type PersistedGatePacket = LiveGateEvidencePacket & {
  version?: string;
  key?: string;
  publishedAt?: string;
};

function runtimeDeps(): JevDecisionShadowRunnerDeps {
  return {
    loadRecent: dbLoadRecent,
    persistResult: async (payload) => {
      const result = await dbQuerySafe(
        "INSERT INTO app_state_log (kind, payload) VALUES ($1, $2::jsonb) RETURNING id",
        [JEV_DECISION_SHADOW_RESULT_PERSIST_KIND, JSON.stringify(payload)],
      );
      return result !== null && result.rows.length > 0;
    },
    fetchImpl: fetch,
    apiKey: process.env.OPENROUTER_API_KEY?.trim() || "",
  };
}

function normalizeLimit(value: number | undefined): number | null {
  if (value === undefined) return 20;
  if (!Number.isInteger(value) || value < 1 || value > 20) return null;
  return value;
}

function sampleId(packet: LiveGateEvidencePacket): string | null {
  const id = packet?.identity;
  const at = Date.parse(id?.observedAt ?? "");
  if (!id || !Number.isFinite(at)) return null;
  const strike = String(id.strike).replace(".", "p");
  const expiry = id.expiryDate.replace(/-/g, "");
  const value = `${id.symbol}_${id.side}_${strike}_${expiry}_D${id.dte}_${at}`;
  return value.length <= 64 && /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value) ? value : null;
}

function base(
  requestedLimit: number,
  sourceRowsScanned: number,
  skipped: Array<{ sourceIndex: number; blockers: string[] }>,
): Omit<JevDecisionShadowRunResult, "ok" | "sampleCount" | "baseline" | "answers" | "usage" | "persisted" | "blocker"> {
  return {
    version: JEV_DECISION_SHADOW_VERSION,
    mode: "RESEARCH_SHADOW_ONLY",
    model: JEV_PINNED_MODEL,
    sourceKind: H1_LIVE_GATE_EVIDENCE_PERSIST_KIND,
    resultPersistKind: JEV_DECISION_SHADOW_RESULT_PERSIST_KIND,
    requestedLimit,
    sourceRowsScanned,
    skippedCount: skipped.length,
    skipped,
    safety: {
      affectsVerdict: false,
      affectsCandidate: false,
      affectsTelegram: false,
      affectsExecution: false,
      createsOrders: false,
      aiMayOverride: false,
      futureOutcomeIncluded: false,
    },
  };
}

export async function runJevDecisionShadowFromExactHistory(
  input: JevDecisionShadowRunInput = {},
  deps: JevDecisionShadowRunnerDeps = runtimeDeps(),
): Promise<JevDecisionShadowRunResult> {
  const limit = normalizeLimit(input.limit);
  if (limit === null) {
    return {
      ...base(0, 0, []),
      ok: false,
      sampleCount: 0,
      baseline: [],
      answers: null,
      usage: null,
      persisted: false,
      blocker: "JEV_LIMIT_REQUIRES_1_TO_20",
    };
  }
  if (input.symbol && !["NIFTY", "SENSEX", "BANKNIFTY"].includes(input.symbol)) {
    return {
      ...base(limit, 0, []),
      ok: false,
      sampleCount: 0,
      baseline: [],
      answers: null,
      usage: null,
      persisted: false,
      blocker: "JEV_SYMBOL_INVALID",
    };
  }
  if (!deps.apiKey.trim()) {
    return {
      ...base(limit, 0, []),
      ok: false,
      sampleCount: 0,
      baseline: [],
      answers: null,
      usage: null,
      persisted: false,
      blocker: "OPENROUTER_API_KEY_REQUIRED",
    };
  }

  const scanLimit = Math.min(100, Math.max(limit * 5, limit));
  const rows = await deps.loadRecent<PersistedGatePacket>(H1_LIVE_GATE_EVIDENCE_PERSIST_KIND, scanLimit);
  const newestFirst = [...rows].reverse();
  const samples = [];
  const skipped: Array<{ sourceIndex: number; blockers: string[] }> = [];
  const seen = new Set<string>();

  for (let sourceIndex = 0; sourceIndex < newestFirst.length && samples.length < limit; sourceIndex += 1) {
    const packet = newestFirst[sourceIndex];
    if (input.symbol && packet?.identity?.symbol !== input.symbol) continue;
    const id = sampleId(packet);
    if (!id || seen.has(id)) {
      skipped.push({ sourceIndex, blockers: [id ? "JEV_DUPLICATE_EXACT_PACKET" : "JEV_SAMPLE_ID_UNAVAILABLE"] });
      continue;
    }
    seen.add(id);
    const made = buildJevDecisionShadowSampleFromLivePacket(id, packet);
    if (!made.sample) {
      skipped.push({ sourceIndex, blockers: made.blockers });
      continue;
    }
    samples.push(made.sample);
  }

  const common = base(limit, rows.length, skipped);
  if (samples.length === 0) {
    return {
      ...common,
      ok: false,
      sampleCount: 0,
      baseline: [],
      answers: null,
      usage: null,
      persisted: false,
      blocker: rows.length === 0 ? "NO_PERSISTED_EXACT_GATE_PACKETS" : "NO_USABLE_EXACT_GATE_PACKETS",
    };
  }

  const plan = buildJevDecisionShadowPlan(samples);
  if (plan.blockers.length > 0) {
    return {
      ...common,
      ok: false,
      sampleCount: 0,
      baseline: [],
      answers: null,
      usage: null,
      persisted: false,
      blocker: `JEV_SHADOW_PLAN_BLOCKED:${plan.blockers.join(",")}`,
    };
  }

  try {
    const response = await callJevDecisionShadow(plan, deps.apiKey, deps.fetchImpl);
    const recordedAt = new Date().toISOString();
    const persisted = await deps.persistResult({
      version: JEV_DECISION_SHADOW_RESULT_PERSIST_KIND,
      recordedAt,
      model: JEV_PINNED_MODEL,
      sourceKind: H1_LIVE_GATE_EVIDENCE_PERSIST_KIND,
      sampleCount: samples.length,
      baseline: plan.baseline,
      answers: response.answers,
      usage: response.usage ?? null,
      provider: response.provider ?? null,
      responseId: response.id ?? null,
      safety: common.safety,
    });

    return {
      ...common,
      ok: persisted,
      sampleCount: samples.length,
      baseline: plan.baseline,
      answers: response.answers,
      usage: response.usage ?? null,
      persisted,
      blocker: persisted ? null : "JEV_RESULT_DB_PERSISTENCE_FAILED",
    };
  } catch (err) {
    return {
      ...common,
      ok: false,
      sampleCount: samples.length,
      baseline: plan.baseline,
      answers: null,
      usage: null,
      persisted: false,
      blocker: err instanceof Error ? err.message : "JEV_DECISION_SHADOW_RUN_FAILED",
    };
  }
}

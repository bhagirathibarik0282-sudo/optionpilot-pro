import { dbQuerySafe } from "./db.js";
import { validateShadowValidationRegimeEvidence } from "./psychology-regime-evidence.ts";
import { adaptPsychologyValidationEvidence, type PsychologyReplayValidationInput } from "./psychology-shadow-replay-adapter.ts";
import { validatePsychologyShadowObservations } from "./psychology-shadow-validation.ts";

export const PSYCHOLOGY_REAL_EVIDENCE_KIND = "PSYCHOLOGY_REAL_EVIDENCE_V1" as const;
export const PSYCHOLOGY_REAL_EVIDENCE_MAX_RECORDS = 2000;

export type PersistablePsychologyEvidenceSource = "REAL_REPLAY" | "LIVE_OBSERVATION";

export interface StoredPsychologyRealEvidence {
  version: "PSYCHOLOGY_REAL_EVIDENCE_STORE_V1";
  semantics: "RESEARCH_SHADOW_ONLY";
  evidenceKey: string;
  source: PersistablePsychologyEvidenceSource;
  recordedAt: string;
  replay: PsychologyReplayValidationInput["replay"];
  validation: PsychologyReplayValidationInput["validation"];
  affectsTelegram: false;
  affectsVerdict: false;
  affectsExecution: false;
}

function validIso(value: string): boolean {
  return value.trim().length > 0 && Number.isFinite(Date.parse(value));
}

export function psychologyEvidenceKey(input: Pick<StoredPsychologyRealEvidence, "source" | "validation">): string {
  return `${input.source}:${input.validation.tradeId.trim()}`;
}

function cloneValidation(validation: PsychologyReplayValidationInput["validation"]): PsychologyReplayValidationInput["validation"] {
  return {
    ...validation,
    regimes: [...validation.regimes],
    ...(validation.regimeEvidence ? { regimeEvidence: validation.regimeEvidence.map((item) => ({ ...item })) } : {}),
  };
}

/** Storage admission remains research-only and fail-closed. */
export function preparePsychologyRealEvidenceForStorage(
  input: PsychologyReplayValidationInput,
  recordedAt: string,
): StoredPsychologyRealEvidence | null {
  if (!validIso(recordedAt)) return null;
  const admitted = adaptPsychologyValidationEvidence(input);
  if (!admitted.accepted || !admitted.observation) return null;
  if (input.source !== "REAL_REPLAY" && input.source !== "LIVE_OBSERVATION") return null;

  try {
    validatePsychologyShadowObservations([admitted.observation]);
  } catch {
    return null;
  }

  if (admitted.observation.regimeEvidence !== undefined) {
    const provenance = validateShadowValidationRegimeEvidence(admitted.observation.regimeEvidence, input.replay.decisionAt);
    if (!provenance.valid) return null;
  }

  const source: PersistablePsychologyEvidenceSource = input.source;
  return {
    version: "PSYCHOLOGY_REAL_EVIDENCE_STORE_V1",
    semantics: "RESEARCH_SHADOW_ONLY",
    evidenceKey: `${source}:${admitted.observation.tradeId.trim()}`,
    source,
    recordedAt: new Date(recordedAt).toISOString(),
    replay: { ...input.replay },
    validation: cloneValidation(admitted.observation),
    affectsTelegram: false,
    affectsVerdict: false,
    affectsExecution: false,
  };
}

export function isStoredPsychologyRealEvidence(value: unknown): value is StoredPsychologyRealEvidence {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<StoredPsychologyRealEvidence>;
  if (row.version !== "PSYCHOLOGY_REAL_EVIDENCE_STORE_V1" || row.semantics !== "RESEARCH_SHADOW_ONLY") return false;
  if (row.source !== "REAL_REPLAY" && row.source !== "LIVE_OBSERVATION") return false;
  if (typeof row.evidenceKey !== "string" || !row.evidenceKey.trim()) return false;
  if (typeof row.recordedAt !== "string" || !validIso(row.recordedAt)) return false;
  if (!row.replay || typeof row.replay !== "object") return false;
  if (!row.validation || typeof row.validation !== "object" || typeof row.validation.tradeId !== "string" || !row.validation.tradeId.trim()) return false;
  if (row.evidenceKey !== psychologyEvidenceKey(row as StoredPsychologyRealEvidence)) return false;
  if (row.affectsTelegram !== false || row.affectsVerdict !== false || row.affectsExecution !== false) return false;

  const readmission = adaptPsychologyValidationEvidence({
    source: row.source,
    replay: row.replay as PsychologyReplayValidationInput["replay"],
    validation: row.validation as PsychologyReplayValidationInput["validation"],
  });
  if (!readmission.accepted || !readmission.observation) return false;

  try {
    validatePsychologyShadowObservations([readmission.observation]);
  } catch {
    return false;
  }

  if (readmission.observation.regimeEvidence !== undefined) {
    const provenance = validateShadowValidationRegimeEvidence(
      readmission.observation.regimeEvidence,
      (row.replay as PsychologyReplayValidationInput["replay"]).decisionAt,
    );
    if (!provenance.valid) return false;
  }
  return true;
}

export function mergeStoredPsychologyRealEvidence(
  rows: readonly StoredPsychologyRealEvidence[],
  maxRecords = PSYCHOLOGY_REAL_EVIDENCE_MAX_RECORDS,
): StoredPsychologyRealEvidence[] {
  const cap = Math.max(1, Math.floor(maxRecords));
  const latest = new Map<string, StoredPsychologyRealEvidence>();
  for (const row of rows) {
    if (!isStoredPsychologyRealEvidence(row)) continue;
    const prior = latest.get(row.evidenceKey);
    if (!prior || Date.parse(row.recordedAt) >= Date.parse(prior.recordedAt)) latest.set(row.evidenceKey, row);
  }
  return [...latest.values()]
    .sort((a, b) => Date.parse(a.recordedAt) - Date.parse(b.recordedAt) || a.evidenceKey.localeCompare(b.evidenceKey))
    .slice(-cap);
}

export async function persistPsychologyRealEvidence(record: StoredPsychologyRealEvidence): Promise<void> {
  if (!isStoredPsychologyRealEvidence(record)) throw new Error("PSYCHOLOGY_REAL_EVIDENCE_INVALID_RECORD");
  const result = await dbQuerySafe(
    "INSERT INTO app_state_log (kind, payload) VALUES ($1, $2::jsonb) RETURNING id",
    [PSYCHOLOGY_REAL_EVIDENCE_KIND, JSON.stringify(record)],
  );
  if (!result) throw new Error("PSYCHOLOGY_REAL_EVIDENCE_PERSIST_FAILED");
}

export async function restorePsychologyRealEvidence(
  maxRecords = PSYCHOLOGY_REAL_EVIDENCE_MAX_RECORDS,
): Promise<StoredPsychologyRealEvidence[]> {
  const cap = Math.max(1, Math.floor(maxRecords));
  const result = await dbQuerySafe<{ payload: StoredPsychologyRealEvidence }>(
    "SELECT payload FROM app_state_log WHERE kind = $1 ORDER BY created_at DESC LIMIT $2",
    [PSYCHOLOGY_REAL_EVIDENCE_KIND, cap * 10],
  );
  if (!result) throw new Error("PSYCHOLOGY_REAL_EVIDENCE_RESTORE_FAILED");
  return mergeStoredPsychologyRealEvidence(result.rows.map((row) => row.payload).reverse(), cap);
}

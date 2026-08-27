export function applyPhase58ServerShadowPersistencePatch(source) {
  const marker = "PHASE58_SERVER_SHADOW_SCORE_PERSISTENCE_V1";
  if (source.includes(marker)) return { source, changed: false };

  const signature = "function runRuleEngineServer(symbol: string, m: IndexMetrics | undefined, validation: ServerValidationResult, sectorBreadth: number | null): ServerRuleEngineResult {";
  const count = source.split(signature).length - 1;
  if (count !== 1) throw new Error(`runRuleEngineServer signature expected exactly once, saw ${count}`);

  let out = source.replace(
    signature,
    "function runRuleEngineServerCore(symbol: string, m: IndexMetrics | undefined, validation: ServerValidationResult, sectorBreadth: number | null): ServerRuleEngineResult {",
  );

  const wrapper = `\n\n// ${marker}\n// Shadow-only observer wrapper around the existing deterministic server Rule Engine.\n// Reuses the exact already-computed result; performs no broker/API fetch and cannot\n// alter score, verdict, Telegram, candidate selection, or execution. The stable\n// market snapshot timestamp is reused so repeated consumers of the same snapshot\n// collapse to the same observation_id via the existing append/idempotent DB write.\nfunction runRuleEngineServer(symbol: string, m: IndexMetrics | undefined, validation: ServerValidationResult, sectorBreadth: number | null): ServerRuleEngineResult {\n  const result = runRuleEngineServerCore(symbol, m, validation, sectorBreadth);\n  const shadow = result as any;\n  const snapshotObservedAt = m?.timestamp && Number.isFinite(Date.parse(m.timestamp))\n    ? m.timestamp\n    : null;\n\n  if (snapshotObservedAt && typeof shadow.score === \"number\" && Number.isFinite(shadow.score) && shadow.verdict !== \"DATA UNAVAILABLE\") {\n    const contributions = shadow.contributions && typeof shadow.contributions === \"object\" && !Array.isArray(shadow.contributions)\n      ? shadow.contributions\n      : {};\n    const overrides = Array.isArray(shadow.overrides) ? shadow.overrides : [];\n    const candidate = shadow.suggestion && typeof shadow.suggestion.side === \"string\"\n      ? shadow.suggestion.side\n      : null;\n\n    void persistKnownThenScoreObservation({\n      symbol,\n      observedAt: snapshotObservedAt,\n      legacyScore: shadow.score,\n      maxScore: typeof shadow.maxScore === \"number\" && Number.isFinite(shadow.maxScore) ? shadow.maxScore : null,\n      legacyVerdict: typeof shadow.verdict === \"string\" ? shadow.verdict : null,\n      contributions,\n      overrides,\n      legacyCandidate: candidate,\n      sourcePath: \"server:runRuleEngineServer\",\n    }).catch((err) => console.error(\"[Phase58] server shadow score persistence failed:\", err instanceof Error ? err.message : err));\n  }\n\n  return result;\n}\n`;

  out += wrapper;
  return { source: out, changed: true };
}

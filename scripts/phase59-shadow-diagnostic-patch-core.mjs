export function applyPhase59ShadowDiagnosticPatch(source) {
  const marker = "PHASE59_SHADOW_DIAGNOSTIC_TRACE_WIRING_V1";
  if (source.includes(marker)) return { source, changed: false };

  const importNeedle = 'import { persistKnownThenScoreObservation, replayPersistedScoresWithoutMaxPain } from "./score-observation-known-then.js"; // PHASE50_KNOWN_THEN_SCORE_WIRING_V1';
  if (!source.includes(importNeedle)) throw new Error("Phase50 score-observation import not found");
  let out = source.replace(importNeedle, `${importNeedle}\nimport { phase59TraceRuleBoundary, phase59TraceRuleResult, phase59TracePersistAttempt, phase59TracePersistResult, phase59TracePersistError, getPhase59ShadowDiagnosticTrace } from "./phase59-shadow-diagnostic-trace.js"; // ${marker}`);

  const resultNeedle = '  const result = runRuleEngineServerCore(symbol, m, validation, sectorBreadth);\n  const shadow = result as any;';
  if (!out.includes(resultNeedle)) throw new Error("Phase58 wrapper result anchor not found");
  out = out.replace(resultNeedle, '  const phase59ObservedAt = phase59TraceRuleBoundary(symbol, m, validation);\n  const result = runRuleEngineServerCore(symbol, m, validation, sectorBreadth);\n  phase59TraceRuleResult(symbol, result);\n  const shadow = result as any;');

  const attemptNeedle = '    void persistKnownThenScoreObservation({';
  if ((out.split(attemptNeedle).length - 1) < 1) throw new Error("persist attempt anchor not found");
  const phase58Start = out.indexOf('// PHASE58_SERVER_SHADOW_SCORE_PERSISTENCE_V1');
  if (phase58Start < 0) throw new Error("Phase58 marker not found");
  const attemptPos = out.indexOf(attemptNeedle, phase58Start);
  if (attemptPos < 0) throw new Error("Phase58 persistence call not found");
  out = out.slice(0, attemptPos) + '    phase59TracePersistAttempt(symbol);\n' + out.slice(attemptPos);

  const catchNeedle = '    }).catch((err) => console.error("[Phase58] server shadow score persistence failed:", err instanceof Error ? err.message : err));';
  if (!out.includes(catchNeedle)) throw new Error("Phase58 catch anchor not found");
  out = out.replace(catchNeedle, '    }).then((observationId) => phase59TracePersistResult(symbol, observationId))\n      .catch((err) => {\n        phase59TracePersistError(symbol, err);\n        console.error("[Phase58] server shadow score persistence failed:", err instanceof Error ? err.message : err);\n      });');

  const routeNeedle = 'app.route("/api/offline-research", offlineResearchRouter);';
  if (!out.includes(routeNeedle)) throw new Error("offline research route anchor not found");
  out = out.replace(routeNeedle, `${routeNeedle}\n\napp.get("/api/research/shadow-diagnostic-trace", (c) => c.json(getPhase59ShadowDiagnosticTrace()));`);

  // Defensive check: observedAt is still sourced from the market snapshot in Phase58.
  if (!out.includes('const snapshotObservedAt = m?.timestamp')) throw new Error("stable snapshot timestamp anchor disappeared");
  if (!out.includes('const phase59ObservedAt = phase59TraceRuleBoundary')) throw new Error("diagnostic boundary wiring failed");
  // Keep variable intentionally visible to audit timestamp equivalence; avoid TS unused concerns by a no-op equality check.
  out = out.replace('  const snapshotObservedAt = m?.timestamp && Number.isFinite(Date.parse(m.timestamp))', '  const snapshotObservedAt = m?.timestamp && Number.isFinite(Date.parse(m.timestamp))');
  out = out.replace('  if (snapshotObservedAt && typeof shadow.score', '  if (phase59ObservedAt === snapshotObservedAt && snapshotObservedAt && typeof shadow.score');

  return { source: out, changed: true };
}

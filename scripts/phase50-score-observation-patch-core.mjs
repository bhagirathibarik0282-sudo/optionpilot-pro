function replaceExactlyOnce(source, regex, replacement, label) {
  const matches = [...source.matchAll(regex)];
  if (matches.length !== 1) throw new Error(`${label} expected exactly once, saw ${matches.length}`);
  return source.replace(regex, replacement);
}

export function applyPhase50ScoreObservationPatch(source) {
  const marker = "PHASE50_KNOWN_THEN_SCORE_WIRING_V1";
  if (source.includes(marker)) return { source, changed: false };

  let out = source;
  const importAnchor = 'import { dbInit, dbInsert, dbLoadRecent, dbIsConfigured } from "./db.js";';
  if (out.split(importAnchor).length - 1 !== 1) throw new Error("db import anchor expected exactly once");
  out = out.replace(importAnchor, importAnchor + '\nimport { persistKnownThenScoreObservation, replayPersistedScoresWithoutMaxPain } from "./score-observation-known-then.js"; // PHASE50_KNOWN_THEN_SCORE_WIRING_V1');

  // Narrow semantic anchor with whitespace tolerance only. We still fail closed
  // unless the exact structural-bias tail occurs once in current server.ts.
  out = replaceExactlyOnce(
    out,
    /^([ \t]*)structuralBias: classifyIndexOverallBias\(m\),\r?\n([ \t]*)};/gm,
    (_match, fieldIndent, closeIndent) => `${fieldIndent}structuralBias: classifyIndexOverallBias(m),\n${fieldIndent}// Phase 50: exact already-computed deterministic decision-time state.\n${fieldIndent}// No recomputation, no new market-data call, no trading side effect.\n${fieldIndent}ruleScore: result.score,\n${fieldIndent}ruleMaxScore: result.maxScore,\n${fieldIndent}ruleVerdict: result.verdict,\n${fieldIndent}ruleContributions: result.contributions || {},\n${fieldIndent}ruleOverrides: result.overrides || [],\n${fieldIndent}ruleCandidateSide: result.suggestion && result.suggestion.side ? result.suggestion.side : null,\n${closeIndent}};`,
    "premium diagnostic client snapshot anchor",
  );

  out = replaceExactlyOnce(
    out,
    /^([ \t]*)structuralBias: string \| null;\r?\n([ \t]*)}$/gm,
    (_match, fieldIndent, closeIndent) => `${fieldIndent}structuralBias: string | null;\n${fieldIndent}ruleScore?: number | null;\n${fieldIndent}ruleMaxScore?: number | null;\n${fieldIndent}ruleVerdict?: string | null;\n${fieldIndent}ruleContributions?: Record<string, number>;\n${fieldIndent}ruleOverrides?: string[];\n${fieldIndent}ruleCandidateSide?: string | null;\n${closeIndent}}`,
    "PremiumDiagnosticSnapshot interface anchor",
  );

  out = replaceExactlyOnce(
    out,
    /^([ \t]*)premiumDiagnosticBuffer\.get\(key\)!\.push\(body\.snapshot\);\r?\n([ \t]*)return c\.json\(\{ ok: true, windowId, bufferedCount: premiumDiagnosticBuffer\.get\(key\)!\.length \}\);/gm,
    (_match, pushIndent, returnIndent) => `${pushIndent}premiumDiagnosticBuffer.get(key)!.push(body.snapshot);\n${pushIndent}// Phase 50 shadow persistence: store only the exact score decomposition\n${pushIndent}// supplied at decision time. Fire-and-forget and flag-gated inside the\n${pushIndent}// persistence module; failure can never block the existing diagnostic path.\n${pushIndent}if (typeof body.snapshot.ruleScore === "number" && Number.isFinite(body.snapshot.ruleScore)) {\n${pushIndent}  void persistKnownThenScoreObservation({\n${pushIndent}    symbol: body.symbol,\n${pushIndent}    observedAt: body.snapshot.timestamp,\n${pushIndent}    legacyScore: body.snapshot.ruleScore,\n${pushIndent}    maxScore: body.snapshot.ruleMaxScore ?? null,\n${pushIndent}    legacyVerdict: body.snapshot.ruleVerdict ?? null,\n${pushIndent}    contributions: body.snapshot.ruleContributions ?? {},\n${pushIndent}    overrides: body.snapshot.ruleOverrides ?? [],\n${pushIndent}    legacyCandidate: body.snapshot.ruleCandidateSide ?? null,\n${pushIndent}    sourcePath: "/api/premium-diagnostic/snapshot",\n${pushIndent}  }).catch((err) => console.error("[Phase50] score observation persistence failed:", err instanceof Error ? err.message : err));\n${pushIndent}}\n${returnIndent}return c.json({ ok: true, windowId, bufferedCount: premiumDiagnosticBuffer.get(key)!.length });`,
    "premium diagnostic persistence route anchor",
  );

  const latestRouteAnchor = 'app.get("/api/premium-diagnostic/latest", (c) => {';
  if (out.split(latestRouteAnchor).length - 1 !== 1) throw new Error("premium diagnostic latest route anchor expected exactly once");
  out = out.replace(latestRouteAnchor,
`// Phase 50 read-only research replay. Threshold list is deliberately empty:
// this route reports score impact only and does not invent/freeze production thresholds.
app.get("/api/research/max-pain-counterfactual", async (c) => {
  const symbol = c.req.query("symbol") || undefined;
  const result = await replayPersistedScoresWithoutMaxPain(symbol, []);
  return c.json({ architectureRole: "RESEARCH_ONLY_KNOWN_THEN_COUNTERFACTUAL", productionImpact: "NONE", ...result });
});

${latestRouteAnchor}`);

  return { source: out, changed: true };
}

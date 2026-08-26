export function applyPhase50ScoreObservationPatch(source) {
  const marker = "PHASE50_KNOWN_THEN_SCORE_WIRING_V1";
  if (source.includes(marker)) return { source, changed: false };

  let out = source;
  const importAnchor = 'import { dbInit, dbInsert, dbLoadRecent, dbIsConfigured } from "./db.js";';
  if (!out.includes(importAnchor)) throw new Error("db import anchor missing");
  out = out.replace(importAnchor, importAnchor + '\nimport { persistKnownThenScoreObservation, replayPersistedScoresWithoutMaxPain } from "./score-observation-known-then.js"; // PHASE50_KNOWN_THEN_SCORE_WIRING_V1');

  const snapshotAnchor = '      structuralBias: classifyIndexOverallBias(m),\n    };';
  if (!out.includes(snapshotAnchor)) throw new Error("premium diagnostic client snapshot anchor missing");
  out = out.replace(snapshotAnchor,
`      structuralBias: classifyIndexOverallBias(m),
      // Phase 50: exact already-computed deterministic decision-time state.
      // No recomputation, no new market-data call, no trading side effect.
      ruleScore: result.score,
      ruleMaxScore: result.maxScore,
      ruleVerdict: result.verdict,
      ruleContributions: result.contributions || {},
      ruleOverrides: result.overrides || [],
      ruleCandidateSide: result.suggestion && result.suggestion.side ? result.suggestion.side : null,
    };`);

  const interfaceAnchor = '  structuralBias: string | null;\n}';
  if (!out.includes(interfaceAnchor)) throw new Error("PremiumDiagnosticSnapshot interface anchor missing");
  out = out.replace(interfaceAnchor,
`  structuralBias: string | null;
  ruleScore?: number | null;
  ruleMaxScore?: number | null;
  ruleVerdict?: string | null;
  ruleContributions?: Record<string, number>;
  ruleOverrides?: string[];
  ruleCandidateSide?: string | null;
}`);

  const routeAnchor = '  premiumDiagnosticBuffer.get(key)!.push(body.snapshot);\n  return c.json({ ok: true, windowId, bufferedCount: premiumDiagnosticBuffer.get(key)!.length });';
  if (!out.includes(routeAnchor)) throw new Error("premium diagnostic persistence route anchor missing");
  out = out.replace(routeAnchor,
`  premiumDiagnosticBuffer.get(key)!.push(body.snapshot);
  // Phase 50 shadow persistence: store only the exact score decomposition
  // supplied at decision time. Fire-and-forget and flag-gated inside the
  // persistence module; failure can never block the existing diagnostic path.
  if (typeof body.snapshot.ruleScore === "number" && Number.isFinite(body.snapshot.ruleScore)) {
    void persistKnownThenScoreObservation({
      symbol: body.symbol,
      observedAt: body.snapshot.timestamp,
      legacyScore: body.snapshot.ruleScore,
      maxScore: body.snapshot.ruleMaxScore ?? null,
      legacyVerdict: body.snapshot.ruleVerdict ?? null,
      contributions: body.snapshot.ruleContributions ?? {},
      overrides: body.snapshot.ruleOverrides ?? [],
      legacyCandidate: body.snapshot.ruleCandidateSide ?? null,
      sourcePath: "/api/premium-diagnostic/snapshot",
    }).catch((err) => console.error("[Phase50] score observation persistence failed:", err instanceof Error ? err.message : err));
  }
  return c.json({ ok: true, windowId, bufferedCount: premiumDiagnosticBuffer.get(key)!.length });`);

  const latestRouteAnchor = 'app.get("/api/premium-diagnostic/latest", (c) => {';
  if (!out.includes(latestRouteAnchor)) throw new Error("premium diagnostic latest route anchor missing");
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

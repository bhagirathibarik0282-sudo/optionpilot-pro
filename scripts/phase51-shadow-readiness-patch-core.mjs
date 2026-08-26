export function applyPhase51ShadowReadinessPatch(source) {
  const marker = "PHASE51_SHADOW_READINESS_WIRING_V1";
  if (source.includes(marker)) return { source, changed: false };

  const phase50Import = 'import { persistKnownThenScoreObservation, replayPersistedScoresWithoutMaxPain } from "./score-observation-known-then.js"; // PHASE50_KNOWN_THEN_SCORE_WIRING_V1';
  const count = source.split(phase50Import).length - 1;
  if (count !== 1) throw new Error(`Phase 50 import anchor expected exactly once, saw ${count}`);
  let out = source.replace(
    phase50Import,
    phase50Import + '\nimport { getPhase51ShadowReadiness } from "./phase51-shadow-readiness.js"; // PHASE51_SHADOW_READINESS_WIRING_V1',
  );

  const routeAnchor = 'app.get("/api/research/max-pain-counterfactual", async (c) => {';
  const routeCount = out.split(routeAnchor).length - 1;
  if (routeCount !== 1) throw new Error(`Phase 50 counterfactual route anchor expected exactly once, saw ${routeCount}`);
  out = out.replace(routeAnchor,
`// Phase 51 read-only shadow observability. This route never mutates the
// PHASE50_SCORE_SHADOW flag and never promotes production readiness.
app.get("/api/research/shadow-readiness", async (c) => {
  const symbol = c.req.query("symbol") || undefined;
  const rawLimit = Number(c.req.query("limit") || 5000);
  const limit = Number.isFinite(rawLimit) ? rawLimit : 5000;
  return c.json(await getPhase51ShadowReadiness(symbol, limit));
});

${routeAnchor}`);

  return { source: out, changed: true };
}

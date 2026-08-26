export function applyPhase53ShadowPreflightPatch(source) {
  const marker = "PHASE53_SHADOW_PREFLIGHT_WIRING_V1";
  if (source.includes(marker)) return { source, changed: false };

  const phase51Import = 'import { getPhase51ShadowReadiness } from "./phase51-shadow-readiness.js"; // PHASE51_SHADOW_READINESS_WIRING_V1';
  const importCount = source.split(phase51Import).length - 1;
  if (importCount !== 1) throw new Error(`Phase 51 import anchor expected exactly once, saw ${importCount}`);
  let out = source.replace(
    phase51Import,
    phase51Import + '\nimport { getPhase53ShadowPreflight } from "./phase53-shadow-preflight.js"; // PHASE53_SHADOW_PREFLIGHT_WIRING_V1',
  );

  const routeAnchor = 'app.get("/api/research/shadow-readiness", async (c) => {';
  const routeCount = out.split(routeAnchor).length - 1;
  if (routeCount !== 1) throw new Error(`Phase 51 readiness route anchor expected exactly once, saw ${routeCount}`);
  out = out.replace(routeAnchor,
`// Phase 53 read-only activation preflight. It never mutates PHASE50_SCORE_SHADOW.
app.get("/api/research/shadow-preflight", async (c) => {
  const symbol = c.req.query("symbol") || undefined;
  return c.json(await getPhase53ShadowPreflight(symbol));
});

${routeAnchor}`);

  return { source: out, changed: true };
}

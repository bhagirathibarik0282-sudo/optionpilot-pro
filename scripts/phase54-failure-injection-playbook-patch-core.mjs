export function applyPhase54FailureInjectionPlaybookPatch(source) {
  const marker = "PHASE54_FAILURE_INJECTION_PLAYBOOK_WIRING_V1";
  if (source.includes(marker)) return { source, changed: false };

  const phase53Import = 'import { getPhase53ShadowPreflight } from "./phase53-shadow-preflight.js"; // PHASE53_SHADOW_PREFLIGHT_WIRING_V1';
  const importCount = source.split(phase53Import).length - 1;
  if (importCount !== 1) throw new Error(`Phase 53 import anchor expected exactly once, saw ${importCount}`);
  let out = source.replace(
    phase53Import,
    phase53Import + '\nimport { buildPhase54PreparationReport, PHASE54_PLAYBOOK } from "./phase54-failure-injection-playbook.js"; // PHASE54_FAILURE_INJECTION_PLAYBOOK_WIRING_V1',
  );

  const routeAnchor = 'app.get("/api/research/shadow-preflight", async (c) => {';
  const routeCount = out.split(routeAnchor).length - 1;
  if (routeCount !== 1) throw new Error(`Phase 53 preflight route anchor expected exactly once, saw ${routeCount}`);
  out = out.replace(routeAnchor,
`// Phase 54 read-only failure-injection execution playbook.
// It does not execute faults or mutate live production state.
app.get("/api/research/failure-injection-playbook", (c) => {
  return c.json({ ...buildPhase54PreparationReport(), scenarios: PHASE54_PLAYBOOK });
});

${routeAnchor}`);

  return { source: out, changed: true };
}

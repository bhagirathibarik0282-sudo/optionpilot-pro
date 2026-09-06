import test from "node:test";
import assert from "node:assert/strict";
import { buildFiiDiiDashboardContextView } from "../canonical-fii-dii-dashboard-context-adapter.ts";
import type { CanonicalFiiDiiPracticalContextV2 } from "../canonical-fii-dii-practical-ingest-v2.ts";

function source(): CanonicalFiiDiiPracticalContextV2 {
  return {
    version: "CANONICAL_FII_DII_PRACTICAL_INGEST_V2",
    ready: true,
    latestSessionDate: "2026-09-04",
    history: [],
    windows: [
      { window:"1D", requiredSessions:1, ready:true, availableSessions:1, fiiNetCrore:-100, diiNetCrore:80, combinedNetCrore:-20 },
      { window:"3D", requiredSessions:3, ready:false, availableSessions:1, fiiNetCrore:null, diiNetCrore:null, combinedNetCrore:null },
      { window:"5D", requiredSessions:5, ready:false, availableSessions:1, fiiNetCrore:null, diiNetCrore:null, combinedNetCrore:null },
      { window:"20D", requiredSessions:20, ready:false, availableSessions:1, fiiNetCrore:null, diiNetCrore:null, combinedNetCrore:null },
    ],
    blockers: [], warnings: ["FII_DII_WINDOW_NOT_READY:3D:1/3","FII_DII_WINDOW_NOT_READY:5D:1/5","FII_DII_WINDOW_NOT_READY:20D:1/20"],
    sourceUrl: "https://www.nseindia.com/api/fiidiiTradeReact",
    sourceMode: "OFFICIAL_NSE_SESSION_API",
    readOnly:true, previousSessionContextOnly:true, estimatesMissingValues:false, grantsDirectionalSupport:false,
    affectsVerdict:false, affectsCandidate:false, affectsExecution:false, affectsTelegram:false, failClosed:true,
  };
}

test("exposes verified FII DII numeric context for presentation without authority", () => {
  const out = buildFiiDiiDashboardContextView(source());
  assert.equal(out.ready, true);
  assert.equal(out.latestSessionDate, "2026-09-04");
  assert.equal(out.windows[0].state, "READY");
  assert.equal(out.windows[0].fiiNetCrore, -100);
  assert.equal(out.windows[0].diiNetCrore, 80);
  assert.equal(out.windows[1].state, "ACCUMULATING_HISTORY");
  assert.equal(out.grantsDirectionalSupport, false);
  assert.equal(out.affectsCandidate, false);
  assert.equal(out.affectsTelegram, false);
});

test("fails closed when source is not ready or authority boundary is tampered", () => {
  const unready = source(); unready.ready = false;
  assert.equal(buildFiiDiiDashboardContextView(unready).ready, false);
  const tampered = source(); (tampered as any).affectsCandidate = true;
  const result = buildFiiDiiDashboardContextView(tampered);
  assert.equal(result.ready, false);
  assert.ok(result.blockers.includes("FII_DII_DASHBOARD_AUTHORITY_BOUNDARY_INVALID"));
});

test("fails closed on invalid window payload instead of fabricating values", () => {
  const invalid = source();
  invalid.windows[1] = { ...invalid.windows[1], ready:true, fiiNetCrore:null, diiNetCrore:null, combinedNetCrore:null };
  const result = buildFiiDiiDashboardContextView(invalid);
  assert.equal(result.ready, false);
  assert.ok(result.blockers.includes("FII_DII_DASHBOARD_WINDOWS_INVALID"));
});

import test from "node:test";
import assert from "node:assert/strict";
import { runFiiDiiProductionReadinessHttp } from "../canonical-fii-dii-production-readiness-http.ts";

function readyResult() {
  return {
    version: "CANONICAL_FII_DII_PRODUCTION_READINESS_V1" as const,
    ready: true,
    expectedMarketSessionDate: "2026-09-04",
    latestStoredSessionDate: "2026-09-04",
    storedSessionCount: 5,
    freshAgainstLatestRecordedMarketSession: true,
    windows: [], warnings: [], blockers: [], source: "OFFICIAL_NSE" as const,
    sourceMode: "PRODUCTION_DB_READBACK" as const,
    semantics: "PREVIOUS_SESSION_CONTEXT_ONLY_NO_DIRECTION_TRUTH" as const,
    readOnly: true as const, contextOnly: true as const,
    grantsDirectionalSupport: false as const, affectsVerdict: false as const,
    affectsCandidate: false as const, affectsTelegram: false as const,
    affectsExecution: false as const, mutatesData: false as const, failClosed: true as const,
  };
}

test("returns 200 only for ready production DB readback", async () => {
  const out = await runFiiDiiProductionReadinessHttp(async () => readyResult());
  assert.equal(out.status, 200);
  assert.equal(out.body.ok, true);
  assert.equal(out.body.mode, "READ_ONLY_FII_DII_PRODUCTION_READINESS_V1");
  assert.equal(out.body.productionImpact, "NONE");
  assert.equal(out.body.affectsTelegram, false);
  assert.equal(out.body.affectsExecution, false);
});

test("returns 503 when evaluator is not ready", async () => {
  const out = await runFiiDiiProductionReadinessHttp(async () => ({ ...readyResult(), ready: false, blockers: ["FII_DII_OFFICIAL_SESSION_BEHIND_MARKET"] }));
  assert.equal(out.status, 503);
  assert.equal(out.body.ok, false);
});

test("fails closed on DB/runtime error without exposing authority", async () => {
  const out = await runFiiDiiProductionReadinessHttp(async () => { throw new Error("DATABASE_URL_REQUIRED_FOR_FII_DII_JOB"); });
  assert.equal(out.status, 503);
  assert.equal(out.body.ok, false);
  assert.equal(out.body.readOnly, true);
  assert.equal(out.body.affectsVerdict, false);
  assert.equal(out.body.affectsCandidate, false);
  assert.equal(out.body.affectsTelegram, false);
  assert.equal(out.body.affectsExecution, false);
  assert.equal(out.body.failClosed, true);
});

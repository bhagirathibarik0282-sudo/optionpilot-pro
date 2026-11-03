import assert from "node:assert/strict";
import test from "node:test";

const URL = "https://optionpilot-pro-v2-production.up.railway.app/api/research/fii-dii/production-readiness";

test("production FII DII readiness reflects actual DB state and remains context-only", async () => {
  const response = await fetch(URL, { headers: { accept: "application/json" } });
  const body = await response.json() as any;
  console.log(JSON.stringify(body));

  assert.equal(body.version, "CANONICAL_FII_DII_PRODUCTION_READINESS_V1");
  assert.equal(body.source, "OFFICIAL_NSE");
  assert.equal(body.sourceMode, "PRODUCTION_DB_READBACK");
  assert.equal(body.readOnly, true);
  assert.equal(body.contextOnly, true);
  assert.equal(body.grantsDirectionalSupport, false);
  assert.equal(body.affectsVerdict, false);
  assert.equal(body.affectsCandidate, false);
  assert.equal(body.affectsTelegram, false);
  assert.equal(body.affectsExecution, false);
  assert.equal(body.mutatesData, false);
  assert.equal(body.failClosed, true);

  assert.match(body.expectedMarketSessionDate ?? "", /^\d{4}-\d{2}-\d{2}$/);
  assert.match(body.latestStoredSessionDate ?? "", /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(typeof body.freshAgainstLatestRecordedMarketSession, "boolean");
  assert.equal(typeof body.ready, "boolean");
  assert.equal(response.status, body.ready ? 200 : 503);
  assert.ok(Array.isArray(body.windows));
  assert.equal(body.windows.find((w: any) => w.window === "1D")?.ready, true);

  if (!body.ready) {
    const hasExplicitReason =
      (Array.isArray(body.blockers) && body.blockers.length > 0) ||
      body.windows.some((w: any) => w.ready === false);
    assert.equal(hasExplicitReason, true);
  }
});

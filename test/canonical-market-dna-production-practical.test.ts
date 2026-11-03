import assert from "node:assert/strict";
import test from "node:test";

const URL = "https://optionpilot-pro-v2-production.up.railway.app/api/research/broad-market-size/market-dna-context";

test("production Market DNA context consumes live seven-index data plus recovered full history", async () => {
  const response = await fetch(URL, { headers: { accept: "application/json" } });
  assert.equal(response.ok, true, `HTTP_${response.status}`);
  const body = await response.json() as any;
  console.log(JSON.stringify(body));

  assert.equal(body.ok, true);
  assert.equal(body.ready, true);
  assert.equal(body.contextOnly, true);
  assert.equal(body.readOnly, true);
  assert.equal(body.duplicateVoteForbidden, true);
  assert.equal(body.grantsDirectionalSupport, false);
  assert.equal(body.affectsVerdictDirectly, false);
  assert.equal(body.affectsCandidateDirectly, false);
  assert.equal(body.affectsTelegramDirectly, false);
  assert.equal(body.affectsExecution, false);
  assert.equal(body.repairsMissingEvidence, false);

  assert.ok(body.live);
  assert.equal(body.live.ready, true);
  assert.ok(body.historical);
  assert.equal(body.historical.ready, true);
  assert.equal(body.historical.exactSevenCoverage, true);
  assert.equal(body.historical.alignedLatestDate, true);
  assert.equal(body.historical.archiveBeyond320Ready, true);
  assert.equal(body.historical.tenYearWindowReady, true);
  assert.ok(body.historical.minimumObservations > 320);
  assert.equal(Array.isArray(body.historical.rows), true);
  assert.equal(body.historical.rows.length, 7);
  assert.equal(Array.isArray(body.blockers), true);
  assert.equal(body.blockers.length, 0);
});

import test from "node:test";
import assert from "node:assert/strict";
import { researchRouter } from "../research-router.js";

test("candidate ranking shadow status route is mounted and read-only", async () => {
  const response = await researchRouter.request("/candidate-ranking-shadow/status");
  assert.equal(response.status, 200);

  const body = await response.json() as {
    ok: boolean;
    mode: string;
    productionImpact: string;
    ready: boolean;
    sourceBinding: string;
    maxCandidates: number;
    safety: {
      readOnly: boolean;
      databaseWrites: boolean;
      telegramWrites: boolean;
      executionAuthority: boolean;
      createsOrders: boolean;
    };
  };

  assert.equal(body.ok, true);
  assert.equal(body.mode, "READ_ONLY_CANDIDATE_RANKING_SHADOW_V1");
  assert.equal(body.productionImpact, "NONE");
  assert.equal(body.ready, true);
  assert.equal(body.sourceBinding, "CALLER_SUPPLIED_CANDIDATE_POOL");
  assert.equal(body.maxCandidates, 50);
  assert.equal(body.safety.readOnly, true);
  assert.equal(body.safety.databaseWrites, false);
  assert.equal(body.safety.telegramWrites, false);
  assert.equal(body.safety.executionAuthority, false);
  assert.equal(body.safety.createsOrders, false);
});

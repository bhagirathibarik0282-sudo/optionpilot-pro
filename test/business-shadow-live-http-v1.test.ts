import test from "node:test";
import assert from "node:assert/strict";
import { researchRouter } from "../research-router.ts";

test("business shadow live status route is read-only and authority-free", async () => {
  const response = await researchRouter.request("/business-shadow-live/status");
  assert.equal(response.status, 200);
  const body = await response.json() as any;
  assert.equal(body.ok, true);
  assert.equal(body.mode, "READ_ONLY_BUSINESS_SHADOW_LIVE_V1");
  assert.equal(body.productionImpact, "NONE");
  assert.equal(body.ready, true);
  assert.equal(body.safety.readOnly, true);
  assert.equal(body.safety.databaseWrites, false);
  assert.equal(body.safety.telegramWrites, false);
  assert.equal(body.safety.executionAuthority, false);
  assert.equal(body.safety.candidateAuthority, false);
  assert.equal(body.safety.starAuthority, false);
  assert.equal(body.safety.createsOrders, false);
});

test("business shadow live evaluate route fails closed on invalid input", async () => {
  const response = await researchRouter.request("/business-shadow-live/evaluate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  assert.equal(response.status, 400);
  const body = await response.json() as any;
  assert.equal(body.ok, false);
  assert.equal(body.productionImpact, "NONE");
  assert.equal(body.result?.ready, false);
  assert.equal(body.safety.telegramWrites, false);
  assert.equal(body.safety.executionAuthority, false);
  assert.equal(body.safety.candidateAuthority, false);
  assert.equal(body.safety.starAuthority, false);
  assert.equal(body.safety.createsOrders, false);
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  parseH1ShadowDteBurdenOverrides,
  resolveH1ShadowDteBurdenPolicy,
} from "../h1-shadow-dte-burden-policy-v1.js";

const base = {
  maxObservationAgeMs: 60_000,
  maxAbsThetaPctOfPremium: 3,
  minIv: 8,
  maxIv: 30,
  requiredPeerCount: 2,
  maxConflictingPeerCount: 0,
};

test("uses explicit DTE0 shadow override without mutating peer policy fields", () => {
  const overrides = parseH1ShadowDteBurdenOverrides({
    EXPIRY_0_1: {
      maxAbsThetaPctOfPremium: 500,
      minIv: 8,
      maxIv: 45,
    },
  });
  const out = resolveH1ShadowDteBurdenPolicy(0, base, overrides);
  assert.equal(out.bucket, "EXPIRY_0_1");
  assert.equal(out.source, "SHADOW_DTE_OVERRIDE");
  assert.equal(out.policy.maxAbsThetaPctOfPremium, 500);
  assert.equal(out.policy.maxIv, 45);
  assert.equal(out.policy.requiredPeerCount, 2);
  assert.equal(out.policy.maxObservationAgeMs, 60_000);
  assert.equal(out.productionImpact, "NONE");
  assert.equal(out.affectsSelector, false);
  assert.equal(out.affectsBusinessCard, false);
  assert.equal(out.affectsTelegram, false);
  assert.equal(out.affectsExecution, false);
});

test("falls back to global burden policy when bucket override is absent", () => {
  const out = resolveH1ShadowDteBurdenPolicy(3, base, {});
  assert.equal(out.bucket, "NEAR_2_4");
  assert.equal(out.source, "GLOBAL_BASE");
  assert.deepEqual(out.policy, base);
});

test("rejects invalid override bucket and invalid IV range", () => {
  assert.throws(
    () => parseH1ShadowDteBurdenOverrides({ UNKNOWN: { maxAbsThetaPctOfPremium: 1, minIv: 1, maxIv: 2 } }),
    /BUCKET_INVALID/,
  );
  assert.throws(
    () => parseH1ShadowDteBurdenOverrides({
      EXPIRY_0_1: { maxAbsThetaPctOfPremium: 1, minIv: 40, maxIv: 20 },
    }),
    /OVERRIDE_INVALID/,
  );
});

test("rejects invalid DTE instead of silently applying a bucket", () => {
  assert.throws(() => resolveH1ShadowDteBurdenPolicy(-1, base, {}), /INVALID_DTE/);
});

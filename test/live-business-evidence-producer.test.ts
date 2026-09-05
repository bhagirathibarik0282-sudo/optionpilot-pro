import test from "node:test";
import assert from "node:assert/strict";
import {
  produceVerifiedLiveBusinessEvidence,
  type LiveBusinessEvidenceFamily,
  type VerifiedLiveBusinessFact,
} from "../live-business-evidence-producer.js";

const asOfMs = Date.parse("2026-09-05T10:20:00.000Z");
const observedAtMs = asOfMs - 15_000;
const families: LiveBusinessEvidenceFamily[] = [
  "PRICE_STRUCTURE",
  "FUTURES_CONFIRMATION",
  "PREMIUM_RESPONSE",
  "OI_POSITIONING",
  "MULTI_DTE",
  "VOLATILITY",
  "CROSS_INDEX_BREADTH",
  "RESPONSE_LADDER",
  "LIQUIDITY_EXECUTABILITY",
];
const horizons = ["INTRADAY", "MULTIDAY", "EXPIRY"] as const;

function facts(): VerifiedLiveBusinessFact[] {
  return horizons.flatMap((horizon, hIndex) => families.map((family, fIndex) => ({
    provenance: "LIVE_BUSINESS_FACT_VERIFIED_V1" as const,
    horizon,
    family,
    buyerSupport: 84 - hIndex * 5 - (fIndex % 2),
    sellerSupport: 30 + hIndex * 4 + (fIndex % 2),
    ready: true,
    observedAtMs,
    source: `TEST:${horizon}:${family}`,
    reasons: [`${family} verified`],
  })));
}

test("produces all three horizon scores with explicit Telegram horizon", () => {
  const result = produceVerifiedLiveBusinessEvidence({
    provenance: "LIVE_BUSINESS_FACT_VERIFIED_V1",
    asOfMs,
    telegramHorizon: "INTRADAY",
    facts: facts(),
  });
  assert.equal(result.ready, true);
  assert.ok(result.business);
  assert.equal(result.business?.provenance, "LIVE_BUSINESS_EVIDENCE_VERIFIED_V1");
  assert.equal(result.business?.horizons.length, 3);
  assert.equal(result.business?.horizons.every((h) => h.evidenceReady), true);
  assert.equal(result.business?.telegramHorizon, "INTRADAY");
  assert.equal(result.business?.telegramQualityStars, 5);
  assert.equal(result.equalWeightPolicy, true);
  assert.equal(result.affectsExecution, false);
  assert.equal(result.aiMayOverride, false);
});

test("missing required family fails closed instead of averaging partial evidence", () => {
  const input = facts().filter((x) => !(x.horizon === "EXPIRY" && x.family === "MULTI_DTE"));
  const result = produceVerifiedLiveBusinessEvidence({
    provenance: "LIVE_BUSINESS_FACT_VERIFIED_V1",
    asOfMs,
    telegramHorizon: "INTRADAY",
    facts: input,
  });
  assert.equal(result.ready, false);
  assert.equal(result.business, null);
  assert.ok(result.blockers.includes("EXPIRY:MULTI_DTE:MISSING"));
});

test("stale or future evidence fails closed", () => {
  const stale = facts();
  stale[0] = { ...stale[0], observedAtMs: asOfMs - 90_001 };
  const staleResult = produceVerifiedLiveBusinessEvidence({
    provenance: "LIVE_BUSINESS_FACT_VERIFIED_V1",
    asOfMs,
    telegramHorizon: "INTRADAY",
    facts: stale,
    maxAgeMs: 90_000,
  });
  assert.equal(staleResult.ready, false);
  assert.match(staleResult.blockers.join("|"), /STALE_OR_FUTURE/);

  const future = facts();
  future[1] = { ...future[1], observedAtMs: asOfMs + 1 };
  const futureResult = produceVerifiedLiveBusinessEvidence({
    provenance: "LIVE_BUSINESS_FACT_VERIFIED_V1",
    asOfMs,
    telegramHorizon: "INTRADAY",
    facts: future,
  });
  assert.equal(futureResult.ready, false);
  assert.match(futureResult.blockers.join("|"), /STALE_OR_FUTURE/);
});

test("duplicate family fails closed", () => {
  const input = facts();
  input.push({ ...input[0] });
  const result = produceVerifiedLiveBusinessEvidence({
    provenance: "LIVE_BUSINESS_FACT_VERIFIED_V1",
    asOfMs,
    telegramHorizon: "INTRADAY",
    facts: input,
  });
  assert.equal(result.ready, false);
  assert.match(result.blockers.join("|"), /DUPLICATE/);
});

test("devil flag prevents horizon and Telegram readiness", () => {
  const input = facts();
  input[2] = { ...input[2], devilFlags: ["PREMIUM_RESPONSE_UNSTABLE"] };
  const result = produceVerifiedLiveBusinessEvidence({
    provenance: "LIVE_BUSINESS_FACT_VERIFIED_V1",
    asOfMs,
    telegramHorizon: "INTRADAY",
    facts: input,
  });
  assert.equal(result.ready, false);
  assert.equal(result.business, null);
  assert.ok(result.blockers.includes("TELEGRAM_HORIZON_NOT_READY"));
});

test("historical or unverified provenance cannot enter live business evidence", () => {
  const input = facts();
  input[0] = { ...input[0], provenance: "LIVE_BUSINESS_FACT_VERIFIED_V1" };
  const result = produceVerifiedLiveBusinessEvidence({
    provenance: "LIVE_BUSINESS_FACT_VERIFIED_V1",
    asOfMs,
    telegramHorizon: "MULTIDAY",
    facts: input,
  });
  assert.equal(result.ready, true);

  const invalid = produceVerifiedLiveBusinessEvidence({
    provenance: "HISTORICAL_RESEARCH_ONLY" as any,
    asOfMs,
    telegramHorizon: "MULTIDAY",
    facts: input,
  });
  assert.equal(invalid.ready, false);
  assert.equal(invalid.business, null);
  assert.deepEqual(invalid.blockers, ["INVALID_LIVE_BUSINESS_FACT_PROVENANCE"]);
});

import test from "node:test";
import assert from "node:assert/strict";
import { selectExecutionCandidate } from "../execution-candidate-selector.js";
import { publishCanonicalLiveBusiness } from "../canonical-live-business-publisher.js";
import { canonicalBusinessRuntimeRegistry } from "../canonical-business-runtime-registry.js";

const candidate = {
  symbol: "NIFTY" as const,
  side: "PE" as const,
  strike: 25000,
  expiryDate: "2026-09-08",
  dte: 2,
  moneyness: "ATM" as const,
  premiumLtp: 150,
  capitalFit: true,
  liquidityOk: true,
  spreadOk: true,
  premiumResponseConfirmed: true,
  deltaGammaResponseConfirmed: true,
  thetaIvBurdenAcceptable: true,
  multiExpiryConflictAbsent: true,
  currentOrNearExpiryUsable: true,
  higherDteUsable: false,
};
const horizons = [
  { horizon: "INTRADAY" as const, buyerScore: 86, sellerScore: 35, evidenceReady: true },
  { horizon: "MULTIDAY" as const, buyerScore: 72, sellerScore: 55, evidenceReady: true },
  { horizon: "EXPIRY" as const, buyerScore: 82, sellerScore: 40, evidenceReady: true },
];

test("publishes only exact selector evaluation plus verified live business inputs", () => {
  canonicalBusinessRuntimeRegistry.clear();
  const selector = selectExecutionCandidate(candidate);
  const out = publishCanonicalLiveBusiness(
    { candidate, selector },
    { provenance: "LIVE_BUSINESS_EVIDENCE_VERIFIED_V1", observedAtMs: Date.now(), telegramQualityStars: 5, horizons },
  );
  assert.equal(out.accepted, true);
  assert.equal(out.candidateKey, selector.candidateKey);
  assert.equal(canonicalBusinessRuntimeRegistry.read("NIFTY")?.candidateKey, selector.candidateKey);
});

test("historical or unverified business provenance cannot publish", () => {
  canonicalBusinessRuntimeRegistry.clear();
  const selector = selectExecutionCandidate(candidate);
  const out = publishCanonicalLiveBusiness(
    { candidate, selector },
    { provenance: "HISTORICAL_RESEARCH_ONLY" as any, observedAtMs: Date.now(), telegramQualityStars: 5, horizons },
  );
  assert.equal(out.accepted, false);
  assert.equal(out.reason, "INVALID_BUSINESS_PROVENANCE");
  assert.equal(canonicalBusinessRuntimeRegistry.read("NIFTY"), null);
});

test("all three business horizons are required", () => {
  canonicalBusinessRuntimeRegistry.clear();
  const selector = selectExecutionCandidate(candidate);
  const out = publishCanonicalLiveBusiness(
    { candidate, selector },
    { provenance: "LIVE_BUSINESS_EVIDENCE_VERIFIED_V1", observedAtMs: Date.now(), telegramQualityStars: 5, horizons: horizons.slice(0, 2) },
  );
  assert.equal(out.accepted, false);
  assert.equal(out.reason, "MISSING_REQUIRED_HORIZONS");
});

test("hard selector BLOCK cannot reach canonical runtime registry", () => {
  canonicalBusinessRuntimeRegistry.clear();
  const blockedCandidate = { ...candidate, spreadOk: false };
  const selector = selectExecutionCandidate(blockedCandidate);
  const out = publishCanonicalLiveBusiness(
    { candidate: blockedCandidate, selector },
    { provenance: "LIVE_BUSINESS_EVIDENCE_VERIFIED_V1", observedAtMs: Date.now(), telegramQualityStars: 5, horizons },
  );
  assert.equal(selector.decision, "BLOCK");
  assert.equal(out.accepted, false);
  assert.equal(out.reason, "CANONICAL_PACKET_BLOCKED");
  assert.equal(canonicalBusinessRuntimeRegistry.read("NIFTY"), null);
});

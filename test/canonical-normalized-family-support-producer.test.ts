import assert from "node:assert/strict";
import test from "node:test";
import { produceCanonicalNormalizedFamilySupport, type CanonicalDeterministicFamilySignal } from "../canonical-normalized-family-support-producer.js";
import type { CanonicalBusinessEvidenceInputAdapterResult } from "../canonical-business-evidence-input-adapter.js";
import type { CanonicalMarketFamily } from "../canonical-one-roof-market-snapshot.js";

const families: CanonicalMarketFamily[] = ["MARKET_STRUCTURE","FUTURES_CONFIRMATION","OPTION_PREMIUMS","OI_POSITIONING","MULTI_DTE","VOLATILITY","HEAVYWEIGHTS","SECTOR_BREADTH","RESPONSE_LADDER","LIQUIDITY_EXECUTABILITY"];
const hash = "manifest-1";
const evidence: CanonicalBusinessEvidenceInputAdapterResult = {
  version: "CANONICAL_BUSINESS_EVIDENCE_INPUT_ADAPTER_V1", ready: true, sourceManifestHash: hash, symbol: "NIFTY",
  horizons: ["INTRADAY","MULTIDAY","EXPIRY"].map((horizon) => ({ horizon: horizon as any, buyerScore: null, sellerScore: null, evidenceReady: true, devilFlags: [], reasons: [] })),
  verifiedFamilies: families, blockedFamilies: [], blockers: [], readOnly: true, presentationInputOnly: true, scoresComputed: false,
  candidateSelected: false, telegramSent: false, createsOrders: false, affectsExecution: false, aiMayOverride: false, failClosed: true,
};
const signals = (): CanonicalDeterministicFamilySignal[] => families.map((family, i) => ({
  family, stance: i % 3 === 0 ? "BUYER_SUPPORT" : i % 3 === 1 ? "SELLER_SUPPORT" : "BALANCED",
  strength: i === 0 ? 80 : 40, deterministic: true, evidenceReady: true, sourceId: `engine:${family}`, sourceManifestHash: hash, devilFlags: [],
}));

test("maps explicit stance and strength deterministically without raw payload heuristics", () => {
  const out = produceCanonicalNormalizedFamilySupport({ businessEvidence: evidence, familySignals: signals() });
  assert.equal(out.ready, true);
  assert.equal(out.normalizedEvidence.length, 10);
  assert.deepEqual(out.normalizedEvidence.find((x) => x.family === "MARKET_STRUCTURE") && [out.normalizedEvidence[0].buyerSupport, out.normalizedEvidence[0].sellerSupport], [90, 10]);
  const futures = out.normalizedEvidence.find((x) => x.family === "FUTURES_CONFIRMATION")!;
  assert.deepEqual([futures.buyerSupport, futures.sellerSupport], [30, 70]);
  const option = out.normalizedEvidence.find((x) => x.family === "OPTION_PREMIUMS")!;
  assert.deepEqual([option.buyerSupport, option.sellerSupport], [50, 50]);
  assert.equal(out.rawPayloadHeuristicsUsed, false);
  assert.equal(out.candidateSelected, false);
  assert.equal(out.telegramSent, false);
  assert.equal(out.createsOrders, false);
});

test("missing or duplicate family signal fails closed", () => {
  const missing = signals().slice(1);
  assert.equal(produceCanonicalNormalizedFamilySupport({ businessEvidence: evidence, familySignals: missing }).ready, false);
  const duplicate = [...signals(), signals()[0]];
  assert.equal(produceCanonicalNormalizedFamilySupport({ businessEvidence: evidence, familySignals: duplicate }).ready, false);
});

test("hash mismatch or devil flags fail closed", () => {
  const badHash = signals(); badHash[0] = { ...badHash[0], sourceManifestHash: "other" };
  assert.equal(produceCanonicalNormalizedFamilySupport({ businessEvidence: evidence, familySignals: badHash }).ready, false);
  const devil = signals(); devil[0] = { ...devil[0], devilFlags: ["BLOCK"] };
  assert.equal(produceCanonicalNormalizedFamilySupport({ businessEvidence: evidence, familySignals: devil }).ready, false);
});

test("unverified business evidence fails closed", () => {
  assert.equal(produceCanonicalNormalizedFamilySupport({ businessEvidence: { ...evidence, blockedFamilies: ["VOLATILITY"] }, familySignals: signals() }).ready, false);
});

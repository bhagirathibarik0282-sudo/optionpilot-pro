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
  strength: i === 0 ? 80 : 40, deterministic: true, evidenceReady: true, sourceId: `engine:${family}`, sourceManifestHash: hash,
  sourceSemantics: "EXPLICIT_DIRECTIONAL_SUPPORT", grantsDirectionalSupport: true, devilFlags: [],
}));

test("maps only explicit directional-support signals deterministically", () => {
  const out = produceCanonicalNormalizedFamilySupport({ businessEvidence: evidence, familySignals: signals() });
  assert.equal(out.ready, true);
  assert.equal(out.directionalAuthorityRequired, true);
  assert.equal(out.normalizedEvidence.length, 10);
  const market = out.normalizedEvidence.find((x) => x.family === "MARKET_STRUCTURE")!;
  assert.deepEqual([market.buyerSupport, market.sellerSupport], [90, 10]);
  assert.equal(out.rawPayloadHeuristicsUsed, false);
});

test("context-only positioning evidence cannot masquerade as directional support", () => {
  const rows = signals() as any[];
  rows[3] = { ...rows[3], sourceSemantics: "POSITIONING_CHANGE_CONTEXT_ONLY_NO_DIRECTION_TRUTH", grantsDirectionalSupport: false };
  const out = produceCanonicalNormalizedFamilySupport({ businessEvidence: evidence, familySignals: rows as CanonicalDeterministicFamilySignal[] });
  assert.equal(out.ready, false);
  assert.ok(out.blockers.includes("OI_POSITIONING:FAMILY_SIGNAL_INVALID"));
});

test("missing or duplicate family signal fails closed", () => {
  assert.equal(produceCanonicalNormalizedFamilySupport({ businessEvidence: evidence, familySignals: signals().slice(1) }).ready, false);
  assert.equal(produceCanonicalNormalizedFamilySupport({ businessEvidence: evidence, familySignals: [...signals(), signals()[0]] }).ready, false);
});

test("hash mismatch or devil flags fail closed", () => {
  const badHash = signals(); badHash[0] = { ...badHash[0], sourceManifestHash: "other" };
  assert.equal(produceCanonicalNormalizedFamilySupport({ businessEvidence: evidence, familySignals: badHash }).ready, false);
  const devil = signals(); devil[0] = { ...devil[0], devilFlags: ["BLOCK"] };
  assert.equal(produceCanonicalNormalizedFamilySupport({ businessEvidence: evidence, familySignals: devil }).ready, false);
});

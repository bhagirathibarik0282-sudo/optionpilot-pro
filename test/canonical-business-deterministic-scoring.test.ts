import assert from "node:assert/strict";
import test from "node:test";
import { scoreCanonicalBusinessEvidence, type CanonicalNormalizedBusinessFamilyEvidence } from "../canonical-business-deterministic-scoring.js";
import type { CanonicalBusinessEvidenceInputAdapterResult } from "../canonical-business-evidence-input-adapter.js";
import type { CanonicalMarketFamily } from "../canonical-one-roof-market-snapshot.js";

const families: CanonicalMarketFamily[] = [
  "MARKET_STRUCTURE","FUTURES_CONFIRMATION","OPTION_PREMIUMS","OI_POSITIONING","MULTI_DTE","VOLATILITY","HEAVYWEIGHTS","SECTOR_BREADTH","RESPONSE_LADDER","LIQUIDITY_EXECUTABILITY",
];
const hash = "a".repeat(64);

function businessEvidence(symbol: "NIFTY" | "SENSEX" | "BANKNIFTY" = "NIFTY"): CanonicalBusinessEvidenceInputAdapterResult {
  return {
    version: "CANONICAL_BUSINESS_EVIDENCE_INPUT_ADAPTER_V1", ready: true, sourceManifestHash: hash, symbol,
    horizons: ["INTRADAY","MULTIDAY","EXPIRY"].map((horizon) => ({ horizon: horizon as any, buyerScore: null, sellerScore: null, evidenceReady: true, devilFlags: [], reasons: ["verified"] })),
    verifiedFamilies: [...families], blockedFamilies: [], blockers: [], readOnly: true, presentationInputOnly: true,
    scoresComputed: false, candidateSelected: false, telegramSent: false, createsOrders: false, affectsExecution: false, aiMayOverride: false, failClosed: true,
  };
}

function rows(buyer = 80, seller = 20): CanonicalNormalizedBusinessFamilyEvidence[] {
  return families.map((family) => ({ family, buyerSupport: buyer, sellerSupport: seller, deterministic: true, evidenceReady: true, sourceId: `DET_${family}`, sourceManifestHash: hash, devilFlags: [] }));
}

test("computes auditable horizon scores from all ten deterministic families", () => {
  const out = scoreCanonicalBusinessEvidence({ businessEvidence: businessEvidence(), normalizedEvidence: rows() });
  assert.equal(out.ready, true);
  assert.equal(out.businessUse, "BUYER_ELIGIBLE");
  assert.equal(out.horizons.length, 3);
  for (const horizon of out.horizons) {
    assert.equal(horizon.buyerScore, 80);
    assert.equal(horizon.sellerScore, 20);
    assert.equal(horizon.view.action, "BUYER_EDGE");
    assert.equal(horizon.view.buyerStars, 5);
    assert.equal(Object.keys(horizon.buyerContributionByFamily).length, 10);
  }
  assert.equal(out.candidateSelected, false);
  assert.equal(out.telegramSent, false);
  assert.equal(out.createsOrders, false);
});

test("uses horizon-specific weights deterministically", () => {
  const evidence = rows(50, 50);
  evidence.find((x) => x.family === "OPTION_PREMIUMS")!.buyerSupport = 100;
  evidence.find((x) => x.family === "MULTI_DTE")!.sellerSupport = 100;
  const out = scoreCanonicalBusinessEvidence({ businessEvidence: businessEvidence(), normalizedEvidence: evidence });
  assert.equal(out.ready, true);
  const intraday = out.horizons.find((x) => x.horizon === "INTRADAY")!;
  const multiday = out.horizons.find((x) => x.horizon === "MULTIDAY")!;
  const expiry = out.horizons.find((x) => x.horizon === "EXPIRY")!;
  assert.equal(expiry.buyerScore > multiday.buyerScore, true);
  assert.equal(multiday.sellerScore > intraday.sellerScore, true);
});

test("preserves BANKNIFTY as observation-only monthly", () => {
  const out = scoreCanonicalBusinessEvidence({ businessEvidence: businessEvidence("BANKNIFTY"), normalizedEvidence: rows() });
  assert.equal(out.ready, true);
  assert.equal(out.businessUse, "OBSERVATION_ONLY_MONTHLY");
  assert.equal(out.affectsExecution, false);
});

test("fails closed on missing, duplicate, tampered, or blocked normalized evidence", () => {
  const missing = rows().slice(0, 9);
  assert.equal(scoreCanonicalBusinessEvidence({ businessEvidence: businessEvidence(), normalizedEvidence: missing }).ready, false);

  const duplicate = rows(); duplicate.push({ ...duplicate[0] });
  assert.equal(scoreCanonicalBusinessEvidence({ businessEvidence: businessEvidence(), normalizedEvidence: duplicate }).ready, false);

  const wrongHash = rows(); wrongHash[0].sourceManifestHash = "b".repeat(64);
  assert.equal(scoreCanonicalBusinessEvidence({ businessEvidence: businessEvidence(), normalizedEvidence: wrongHash }).ready, false);

  const devil = rows(); devil[0].devilFlags = ["TEST_BLOCK"];
  assert.equal(scoreCanonicalBusinessEvidence({ businessEvidence: businessEvidence(), normalizedEvidence: devil }).ready, false);

  const blockedBusiness = businessEvidence(); blockedBusiness.blockedFamilies = ["VOLATILITY"];
  blockedBusiness.verifiedFamilies = blockedBusiness.verifiedFamilies.filter((x) => x !== "VOLATILITY");
  assert.equal(scoreCanonicalBusinessEvidence({ businessEvidence: blockedBusiness, normalizedEvidence: rows() }).ready, false);
});

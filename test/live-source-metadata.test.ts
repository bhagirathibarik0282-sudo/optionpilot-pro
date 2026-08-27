import test from "node:test";
import assert from "node:assert/strict";
import { auditCurrentFutureMetadata, auditKitePremiumMetadata } from "../live-source-metadata.js";

const option = {
  strike: 25000,
  instrumentToken: 123456,
  tradingSymbol: "NIFTY26AUG25000CE",
  expiryDate: "2026-08-27",
  optionType: "CE" as const,
  exchange: "NFO",
  segment: "NFO-OPT",
  contractRegime: "LIVE_CONTRACT_MASTER",
};

test("exact Kite live-master option metadata can be identity-valid", () => {
  const r = auditKitePremiumMetadata({ underlying: "NIFTY", expiry: "2026-08-27", strike: 25000, side: "CE", observed: option });
  assert.equal(r.state, "VALID");
  assert.equal(r.usable, true);
  assert.deepEqual(r.reasons, []);
});

test("wrong expiry or side is a hard mismatch", () => {
  const expiry = auditKitePremiumMetadata({ underlying: "NIFTY", expiry: "2026-09-03", strike: 25000, side: "CE", observed: option });
  assert.equal(expiry.state, "MISMATCH");
  assert.ok(expiry.reasons.includes("EXPIRY_MISMATCH"));

  const side = auditKitePremiumMetadata({ underlying: "NIFTY", expiry: "2026-08-27", strike: 25000, side: "PE", observed: option });
  assert.equal(side.state, "MISMATCH");
  assert.ok(side.reasons.includes("OPTION_TYPE_MISMATCH"));
});

test("metadata without live instrument-master provenance is not promoted", () => {
  const r = auditKitePremiumMetadata({ underlying: "NIFTY", expiry: "2026-08-27", strike: 25000, side: "CE", observed: { ...option, contractRegime: null } });
  assert.equal(r.state, "PARTIAL");
  assert.equal(r.usable, false);
  assert.ok(r.reasons.includes("INSTRUMENT_MASTER_PROVENANCE_MISSING"));
});

test("trading symbol shape disagreement is blocked", () => {
  const r = auditKitePremiumMetadata({ underlying: "NIFTY", expiry: "2026-08-27", strike: 25000, side: "CE", observed: { ...option, tradingSymbol: "BANKNIFTY26AUG25000CE" } });
  assert.equal(r.state, "MISMATCH");
  assert.ok(r.reasons.includes("TRADING_SYMBOL_SHAPE_MISMATCH"));
});

test("current futures snapshot stays partial until token/segment are carried through", () => {
  const r = auditCurrentFutureMetadata({ tradingSymbol: "NIFTY26AUGFUT", expiry: "2026-08-27" });
  assert.equal(r.state, "PARTIAL");
  assert.equal(r.usable, false);
  assert.ok(r.reasons.includes("FUTURE_TOKEN_UNAVAILABLE"));
});

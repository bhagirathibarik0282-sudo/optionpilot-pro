import test from "node:test";
import assert from "node:assert/strict";
import { classifyExpiryBuckets, resolveFrontFuture, validateOptionIdentity } from "../instrument-truth.js";
import { classifyFreshness, pairUsability } from "../freshness-engine.js";
import { gateEvidence } from "../source-truth-audit.js";

const base = {
  underlying: "NIFTY",
  exchange: "NSE",
  segment: "NFO",
  instrumentToken: "123",
  tradingSymbol: "NIFTY26AUG25000CE",
  expiry: "2026-08-27",
  strike: 25000,
  optionType: "CE" as const,
};

test("correct contract identity is usable", () => {
  const r = validateOptionIdentity(base, { ...base });
  assert.equal(r.state, "VALID");
  assert.equal(r.usable, true);
});

test("wrong expiry/token is blocked", () => {
  const r = validateOptionIdentity(base, { ...base, instrumentToken: "999", expiry: "2026-09-03" });
  assert.equal(r.state, "MISMATCH");
  assert.equal(r.usable, false);
  assert.ok(r.reasons.includes("TOKEN_MISMATCH"));
  assert.ok(r.reasons.includes("EXPIRY_MISMATCH"));
});

test("expiry classification is date based, not input order", () => {
  const r = classifyExpiryBuckets("2026-08-26", ["2026-09-24", "2026-08-27", "2026-09-03"], ["2026-09-24"]);
  const by = Object.fromEntries(r.map((x) => [x.expiry, x.bucket]));
  assert.equal(by["2026-08-27"], "CURRENT");
  assert.equal(by["2026-09-03"], "NEXT");
  assert.equal(by["2026-09-24"], "MONTHLY");
});

test("current expiry can independently be monthly", () => {
  const r = classifyExpiryBuckets("2026-09-24", ["2026-09-24", "2026-10-01"], ["2026-09-24"]);
  const current = r.find((x) => x.expiry === "2026-09-24");
  assert.equal(current?.bucket, "CURRENT");
  assert.equal(current?.isMonthly, true);
});

test("incomplete critical option identity is blocked", () => {
  const r = validateOptionIdentity({ ...base, expiry: null }, { ...base, expiry: null });
  assert.equal(r.usable, false);
  assert.ok(r.reasons.includes("CONTRACT_IDENTITY_INCOMPLETE"));
});

test("front future resolution ignores array order", () => {
  const r = resolveFrontFuture("2026-08-26", [
    { expiry: "2026-09-24", instrumentToken: 2 },
    { expiry: "2026-08-27", instrumentToken: 1 },
  ]);
  assert.equal(r.state, "VALID");
  assert.equal(r.contract?.instrumentToken, 1);
});

test("duplicate nearest futures are ambiguous", () => {
  const r = resolveFrontFuture("2026-08-26", [
    { expiry: "2026-08-27", instrumentToken: 1 },
    { expiry: "2026-08-27", instrumentToken: 2 },
  ]);
  assert.equal(r.state, "AMBIGUOUS");
  assert.equal(r.contract, null);
});

test("missing source timestamp is never fresh", () => {
  const r = classifyFreshness(null, "2026-08-26T04:00:00.000Z", { freshMaxMs: 30000, agingMaxMs: 90000 });
  assert.equal(r.state, "UNKNOWN");
  assert.equal(r.usability, "BLOCKED");
});

test("present but old timestamp becomes stale", () => {
  const r = classifyFreshness("2026-08-26T03:58:00.000Z", "2026-08-26T04:00:00.000Z", { freshMaxMs: 30000, agingMaxMs: 90000 });
  assert.equal(r.state, "STALE");
  assert.equal(r.usability, "BLOCKED");
});

test("one stale premium leg blocks pair", () => {
  const fresh = classifyFreshness("2026-08-26T03:59:50.000Z", "2026-08-26T04:00:00.000Z", { freshMaxMs: 30000, agingMaxMs: 90000 });
  const stale = classifyFreshness("2026-08-26T03:58:00.000Z", "2026-08-26T04:00:00.000Z", { freshMaxMs: 30000, agingMaxMs: 90000 });
  assert.equal(pairUsability(fresh, stale), "BLOCKED");
});

test("identity mismatch blocks evidence even with fresh timestamp", () => {
  const identity = validateOptionIdentity(base, { ...base, instrumentToken: "999" });
  const freshness = classifyFreshness("2026-08-26T03:59:50.000Z", "2026-08-26T04:00:00.000Z", { freshMaxMs: 30000, agingMaxMs: 90000 });
  const gate = gateEvidence(identity, freshness);
  assert.equal(gate.usability, "BLOCKED");
  assert.equal(gate.qualityState, "INVALID");
});

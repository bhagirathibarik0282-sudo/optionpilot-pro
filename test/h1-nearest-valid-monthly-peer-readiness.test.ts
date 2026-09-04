import test from "node:test";
import assert from "node:assert/strict";
import { buildNearestValidMonthlyPeerReadiness } from "../h1-nearest-valid-monthly-peer-readiness.js";
import type { H1LiveExactRawEvidenceStatus } from "../h1-live-exact-raw-evidence-store.js";
import type { KiteImmediateTokenEntry } from "../kite-immediate-token-registry.js";

const entries: KiteImmediateTokenEntry[] = [
  { instrumentToken: 1, symbol: "BANKNIFTY", role: "SPOT", instrumentLabel: "NIFTY BANK" },
  { instrumentToken: 2, symbol: "BANKNIFTY", role: "OPTION", instrumentLabel: "BNSEPCE", expiry: "2026-09-29", strike: 57600, optionSide: "CE" },
  { instrumentToken: 3, symbol: "BANKNIFTY", role: "OPTION", instrumentLabel: "BNSEPPE", expiry: "2026-09-29", strike: 57600, optionSide: "PE" },
  { instrumentToken: 4, symbol: "BANKNIFTY", role: "OPTION", instrumentLabel: "BNOCTCE", expiry: "2026-10-27", strike: 57600, optionSide: "CE" },
  { instrumentToken: 5, symbol: "BANKNIFTY", role: "OPTION", instrumentLabel: "BNOCTPE", expiry: "2026-10-27", strike: 57600, optionSide: "PE" },
  { instrumentToken: 6, symbol: "BANKNIFTY", role: "OPTION", instrumentLabel: "BNNOVCE", expiry: "2026-11-23", strike: 57600, optionSide: "CE" },
  { instrumentToken: 7, symbol: "BANKNIFTY", role: "OPTION", instrumentLabel: "BNNOVPE", expiry: "2026-11-23", strike: 57600, optionSide: "PE" },
];

function evidence(fresh: number[]): H1LiveExactRawEvidenceStatus {
  return {
    version: "H1_LIVE_EXACT_RAW_EVIDENCE_STORE_V1",
    ready: false,
    expectedTokenCount: 7,
    freshTokenCount: fresh.length,
    staleTokenCount: 0,
    missingTokenCount: 7 - fresh.length,
    rows: fresh.map((instrumentToken) => ({
      instrumentToken,
      symbol: "BANKNIFTY",
      role: instrumentToken === 1 ? "SPOT" : "OPTION",
      instrumentLabel: `T${instrumentToken}`,
      expiry: instrumentToken <= 3 ? "2026-09-29" : instrumentToken <= 5 ? "2026-10-27" : "2026-11-23",
      strike: instrumentToken === 1 ? null : 57600,
      optionSide: instrumentToken === 1 ? null : instrumentToken % 2 === 0 ? "CE" : "PE",
      observedAt: "2026-09-04T08:20:30.000Z",
      receivedAt: "2026-09-04T08:20:30.000Z",
      ltp: 100,
      bid: instrumentToken === 1 ? null : 99,
      ask: instrumentToken === 1 ? null : 101,
      bidQty: instrumentToken === 1 ? null : 10,
      askQty: instrumentToken === 1 ? null : 10,
    })),
    missing: [],
    symbolReadiness: [{
      symbol: "BANKNIFTY",
      primaryExpiry: "2026-09-29",
      primaryReady: fresh.includes(1) && fresh.includes(2) && fresh.includes(3),
      multiExpiryReady: fresh.length === 7,
      primaryExpectedTokenCount: 3,
      primaryFreshTokenCount: fresh.filter((token) => token <= 3).length,
      totalExpectedTokenCount: 7,
      totalFreshTokenCount: fresh.length,
      blockers: [],
    }],
    blockers: [],
    greekEvidenceStatus: "NOT_CONFIGURED",
    productionImpact: "NONE",
    readOnly: true,
    forwardsDownstream: false,
    affectsDirection: false,
    affectsVerdict: false,
    affectsExecution: false,
    affectsTelegram: false,
    failClosed: true,
  };
}

test("nearest peer can be ready while farther peer remains stale", () => {
  const result = buildNearestValidMonthlyPeerReadiness(entries, evidence([1,2,3,4,5]));
  const row = result.rows[0];
  assert.equal(row.primaryExpiry, "2026-09-29");
  assert.equal(row.nearestPeerExpiry, "2026-10-27");
  assert.equal(row.primaryReady, true);
  assert.equal(row.ready, true);
  assert.equal(row.peerExpectedTokenCount, 2);
  assert.equal(row.peerFreshTokenCount, 2);
  assert.deepEqual(row.blockers, []);
  assert.equal(result.readOnly, true);
  assert.equal(result.forwardsDownstream, false);
  assert.equal(result.affectsVerdict, false);
  assert.equal(result.affectsExecution, false);
  assert.equal(result.affectsTelegram, false);
});

test("fails closed when nearest peer pair is incomplete", () => {
  const result = buildNearestValidMonthlyPeerReadiness(entries, evidence([1,2,3,4]));
  const row = result.rows[0];
  assert.equal(row.ready, false);
  assert.equal(row.peerFreshTokenCount, 1);
  assert.match(row.blockers.join("|"), /NEAREST_PEER_EVIDENCE_INCOMPLETE:1\/2/);
});

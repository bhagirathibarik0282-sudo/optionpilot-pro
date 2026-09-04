import test from "node:test";
import assert from "node:assert/strict";
import { buildH1ReadOnlyEvidenceConsumerBoundary } from "../h1-readonly-evidence-consumer-boundary.js";
import type { H1LiveExactRawEvidenceStatus } from "../h1-live-exact-raw-evidence-store.js";
import type { H1NearestValidMonthlyPeerReadinessRow } from "../h1-nearest-valid-monthly-peer-readiness.js";

const t = "2026-09-04T08:33:05.000Z";
const rows = [
  {instrumentToken:1,symbol:"BANKNIFTY",role:"SPOT",instrumentLabel:"NIFTY BANK",expiry:null,strike:null,optionSide:null,observedAt:t,receivedAt:t,ltp:57500,bid:null,ask:null,bidQty:null,askQty:null},
  {instrumentToken:2,symbol:"BANKNIFTY",role:"OPTION",instrumentLabel:"BNSEPCE",expiry:"2026-09-29",strike:57500,optionSide:"CE",observedAt:t,receivedAt:t,ltp:500,bid:499,ask:501,bidQty:10,askQty:10},
  {instrumentToken:3,symbol:"BANKNIFTY",role:"OPTION",instrumentLabel:"BNSEPPE",expiry:"2026-09-29",strike:57500,optionSide:"PE",observedAt:t,receivedAt:t,ltp:480,bid:479,ask:481,bidQty:10,askQty:10},
  {instrumentToken:4,symbol:"BANKNIFTY",role:"OPTION",instrumentLabel:"BNOCTCE",expiry:"2026-10-27",strike:57500,optionSide:"CE",observedAt:t,receivedAt:t,ltp:900,bid:899,ask:901,bidQty:10,askQty:10},
  {instrumentToken:5,symbol:"BANKNIFTY",role:"OPTION",instrumentLabel:"BNOCTPE",expiry:"2026-10-27",strike:57500,optionSide:"PE",observedAt:t,receivedAt:t,ltp:880,bid:879,ask:881,bidQty:10,askQty:10},
] as H1LiveExactRawEvidenceStatus["rows"];

function evidence(sourceRows = rows): H1LiveExactRawEvidenceStatus {
  return {version:"H1_LIVE_EXACT_RAW_EVIDENCE_STORE_V1",ready:true,expectedTokenCount:5,freshTokenCount:sourceRows.length,staleTokenCount:0,missingTokenCount:0,rows:sourceRows,missing:[],symbolReadiness:[{symbol:"BANKNIFTY",primaryExpiry:"2026-09-29",primaryReady:true,multiExpiryReady:true,primaryExpectedTokenCount:3,primaryFreshTokenCount:3,totalExpectedTokenCount:5,totalFreshTokenCount:sourceRows.length,blockers:[]}],blockers:[],greekEvidenceStatus:"NOT_CONFIGURED",productionImpact:"NONE",readOnly:true,forwardsDownstream:false,affectsDirection:false,affectsVerdict:false,affectsExecution:false,affectsTelegram:false,failClosed:true};
}

const nearest: H1NearestValidMonthlyPeerReadinessRow[] = [{symbol:"BANKNIFTY",primaryExpiry:"2026-09-29",nearestPeerExpiry:"2026-10-27",ready:true,primaryReady:true,peerExpectedTokenCount:2,peerFreshTokenCount:2,blockers:[]}];

test("consumes only exact primary plus nearest-peer evidence and remains authority-free", () => {
  const result = buildH1ReadOnlyEvidenceConsumerBoundary(evidence(), nearest);
  assert.equal(result.readySymbolCount, 1);
  assert.equal(result.rows[0].ready, true);
  assert.equal(result.rows[0].evidenceTokenCount, 5);
  assert.equal(result.rows[0].evidence.length, 5);
  assert.equal(result.forwardsToGreeks, false);
  assert.equal(result.forwardsToDirection, false);
  assert.equal(result.forwardsToVerdict, false);
  assert.equal(result.forwardsToExecution, false);
  assert.equal(result.forwardsToTelegram, false);
  assert.equal(result.failClosed, true);
});

test("fails closed and emits no evidence when nearest peer pair is incomplete", () => {
  const incomplete = rows.filter((row) => row.instrumentToken !== 5);
  const result = buildH1ReadOnlyEvidenceConsumerBoundary(evidence(incomplete), nearest);
  assert.equal(result.readySymbolCount, 0);
  assert.equal(result.rows[0].ready, false);
  assert.equal(result.rows[0].evidence.length, 0);
  assert.match(result.rows[0].blockers.join("|"), /NEAREST_PEER_OPTION_PAIR_INVALID/);
});

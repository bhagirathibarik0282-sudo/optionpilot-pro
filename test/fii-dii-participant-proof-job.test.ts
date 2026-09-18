import test from "node:test";
import assert from "node:assert/strict";
import {
  assertParticipantProofReadback,
  participantProofTradeDate,
  requireParticipantProofWriteEnabled,
} from "../fii-dii-participant-proof-job.js";

test("participant proof runner requires an explicit write guard", () => {
  assert.throws(
    () => requireParticipantProofWriteEnabled({}),
    /NSE_PARTICIPANT_PROOF_WRITE_ENABLED_REQUIRED/,
  );
  assert.doesNotThrow(() => requireParticipantProofWriteEnabled({
    NSE_PARTICIPANT_PROOF_WRITE_ENABLED: "1",
  }));
});

test("participant proof runner requires an explicit ISO trade date", () => {
  assert.equal(
    participantProofTradeDate({ NSE_PARTICIPANT_PROOF_TRADE_DATE: "2026-09-17" }),
    "2026-09-17",
  );
  assert.throws(
    () => participantProofTradeDate({ NSE_PARTICIPANT_PROOF_TRADE_DATE: "17-09-2026" }),
    /NSE_PARTICIPANT_PROOF_TRADE_DATE_REQUIRED_ISO/,
  );
  assert.throws(
    () => participantProofTradeDate({}),
    /NSE_PARTICIPANT_PROOF_TRADE_DATE_REQUIRED_ISO/,
  );
});

test("participant proof readback requires exactly eight official identities", () => {
  const identities = [
    ["OI", "CLIENT"], ["OI", "DII"], ["OI", "FII"], ["OI", "PRO"],
    ["VOLUME", "CLIENT"], ["VOLUME", "DII"], ["VOLUME", "FII"], ["VOLUME", "PRO"],
  ] as const;
  const expected = new Map<string, string>();
  const rows = identities.map(([report_kind, participant]) => {
    const source_url = `https://nsearchives.nseindia.com/content/nsccl/fao_participant_${report_kind === "OI" ? "oi" : "vol"}_17092026.csv`;
    expected.set(`${report_kind}:${participant}`, source_url);
    return { report_kind, participant, source_url };
  });
  assert.doesNotThrow(() => assertParticipantProofReadback(rows, expected));
  assert.throws(
    () => assertParticipantProofReadback(rows.slice(0, 7), expected),
    /NSE_PARTICIPANT_PROOF_DB_READBACK_COUNT_MISMATCH/,
  );
});

test("participant proof readback rejects source mismatch", () => {
  const expected = new Map<string, string>([["OI:FII", "https://nsearchives.nseindia.com/content/nsccl/fao_participant_oi_17092026.csv"]]);
  const rows = Array.from({ length: 8 }, (_, index) => ({
    report_kind: index < 4 ? "OI" : "VOLUME",
    participant: ["CLIENT", "DII", "FII", "PRO"][index % 4],
    source_url: "https://nsearchives.nseindia.com/content/nsccl/wrong.csv",
  }));
  assert.throws(
    () => assertParticipantProofReadback(rows, expected),
    /NSE_PARTICIPANT_PROOF_DB_SOURCE_MISMATCH/,
  );
});

import test from "node:test";
import assert from "node:assert/strict";
import { previewH1ContextCommentaryEmission, replayH1ContextCommentaryDryRun } from "../h1-commentary-dry-run-acceptance.js";
import type { H1ContextFusedLowNoiseCommentary } from "../h1-context-fused-low-noise-commentary.js";

function message(key: string, text = key): H1ContextFusedLowNoiseCommentary {
  return {
    version: "H1_CONTEXT_FUSED_LOW_NOISE_COMMENTARY_V1",
    ready: true,
    renderable: true,
    text,
    semanticKey: key,
    blockers: [],
    productionImpact: "NONE",
    telegramSendAllowed: false,
    affectsTelegram: false,
    affectsVerdict: false,
    affectsExecution: false,
    grantsPromotionAuthority: false,
    failClosed: true,
    semantics: "VERIFIED_CONTEXT_ENRICHMENT_ONLY_NO_DIRECTION_OPTION_MAPPING_NO_TRANSPORT",
  };
}

test("A,A,B,B replay emits only meaningful changes", () => {
  const result = replayH1ContextCommentaryDryRun([message("A"), message("A"), message("B"), message("B")]);
  assert.deepEqual(result.events.map((x) => x.action), [
    "DRY_RUN_EMIT_ELIGIBLE",
    "DUPLICATE_SUPPRESSED",
    "DRY_RUN_EMIT_ELIGIBLE",
    "DUPLICATE_SUPPRESSED",
  ]);
  assert.equal(result.eligibleEmitCount, 2);
  assert.equal(result.duplicateSuppressedCount, 2);
  assert.equal(result.blockedCount, 0);
  assert.equal(result.networkSendAttemptCount, 0);
  assert.equal(result.affectsTelegram, false);
  assert.equal(result.affectsVerdict, false);
  assert.equal(result.affectsExecution, false);
  assert.equal(result.failClosed, true);
});

test("duplicate preview contains no text payload", () => {
  const result = previewH1ContextCommentaryEmission("A", message("A", "same state"));
  assert.equal(result.ready, true);
  assert.equal(result.action, "DUPLICATE_SUPPRESSED");
  assert.equal(result.text, null);
  assert.equal(result.networkSendAttempted, false);
  assert.equal(result.telegramSendAllowed, false);
});

test("real semantic change is only dry-run eligible and never sent", () => {
  const result = previewH1ContextCommentaryEmission("A", message("B", "changed state"));
  assert.equal(result.ready, true);
  assert.equal(result.action, "DRY_RUN_EMIT_ELIGIBLE");
  assert.equal(result.text, "changed state");
  assert.equal(result.dryRun, true);
  assert.equal(result.networkSendAttempted, false);
  assert.equal(result.telegramSendAllowed, false);
});

test("dryRun=false is hard blocked", () => {
  const result = previewH1ContextCommentaryEmission(null, message("A"), { dryRun: false });
  assert.equal(result.ready, false);
  assert.equal(result.action, "BLOCKED");
  assert.deepEqual(result.blockers, ["DRY_RUN_REQUIRED"]);
  assert.equal(result.networkSendAttempted, false);
});

test("not-ready or authority-drift commentary is blocked", () => {
  const notReady = { ...message("A"), ready: false, blockers: ["MISSING_CONTEXT"] };
  const blocked = previewH1ContextCommentaryEmission(null, notReady);
  assert.equal(blocked.action, "BLOCKED");
  assert.ok(blocked.blockers.includes("COMMENTARY_NOT_READY"));

  const unsafe = { ...message("B"), affectsTelegram: true as false };
  const unsafeResult = previewH1ContextCommentaryEmission(null, unsafe);
  assert.equal(unsafeResult.action, "BLOCKED");
  assert.ok(unsafeResult.blockers.includes("COMMENTARY_SAFETY_CONTRACT_INVALID"));
});

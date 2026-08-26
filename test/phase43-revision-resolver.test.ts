import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  resolveKnownThen,
  resolveKnownLaterAnalytics,
  revisionReviewSafetyContract,
  sourceTruthRevisionResolverSchemaSql,
} from "../source-truth-revision-resolver.js";

const original = { observation_id: "a".repeat(64), quality_state: "PARTIAL", value: 10 };

test("KNOWN_THEN always returns immutable original even when corrections exist elsewhere", () => {
  const out = resolveKnownThen(original);
  assert.equal(out.payload, original);
  assert.equal(out.mode, "KNOWN_THEN");
  assert.equal(out.usableForHistoricalDecisionReplay, true);
  assert.equal(out.usableForCorrectedAnalytics, false);
  assert.equal(out.hindsightAppliedToDecisionTime, false);
});

test("unreviewed or rejected revisions never change corrected analytics", () => {
  const out = resolveKnownLaterAnalytics(original, [
    { revision_id: "r1", payload: { value: 11 }, review_state: "UNREVIEWED", reviewed_at: null, created_at: "2026-08-26T09:00:00Z" },
    { revision_id: "r2", payload: { value: 12 }, review_state: "REJECTED", reviewed_at: "2026-08-26T09:02:00Z", created_at: "2026-08-26T09:01:00Z" },
  ]);
  assert.equal(out.payload, original);
  assert.equal(out.usableForCorrectedAnalytics, false);
  assert.equal(out.reason, "NO_APPROVED_REVISION_FALLBACK_TO_ORIGINAL");
});

test("latest approved revision is usable only for known-later analytics", () => {
  const out = resolveKnownLaterAnalytics(original, [
    { revision_id: "r1", payload: { value: 11 }, review_state: "APPROVED", reviewed_at: "2026-08-26T09:01:00Z", created_at: "2026-08-26T09:00:00Z" },
    { revision_id: "r2", payload: { value: 12 }, review_state: "APPROVED", reviewed_at: "2026-08-26T09:03:00Z", created_at: "2026-08-26T09:02:00Z" },
  ]);
  assert.deepEqual(out.payload, { value: 12 });
  assert.equal(out.revisionId, "r2");
  assert.equal(out.usableForHistoricalDecisionReplay, false);
  assert.equal(out.usableForCorrectedAnalytics, true);
  assert.equal(out.hindsightAppliedToDecisionTime, false);
});

test("review schema is additive and never rewrites original source truth", () => {
  const sql = sourceTruthRevisionResolverSchemaSql();
  assert.match(sql, /ADD COLUMN IF NOT EXISTS review_state/);
  assert.match(sql, /reviewed_by/);
  assert.doesNotMatch(sql, /UPDATE\s+source_truth_observation_1m|DELETE\s+FROM\s+source_truth_observation_1m|DROP TABLE|TRUNCATE/i);
});

test("safety contract prevents revised hindsight from live production paths", () => {
  const c = revisionReviewSafetyContract();
  assert.equal(c.knownThenNeverRewritten, true);
  assert.equal(c.historicalDecisionReplayUses, "KNOWN_THEN_ONLY");
  assert.equal(c.affectsLiveVerdict, false);
  assert.equal(c.affectsTelegram, false);
  assert.equal(c.affectsExecution, false);
});

test("resolver source contains no trading or Telegram mutation path", () => {
  const src = readFileSync(new URL("../source-truth-revision-resolver.ts", import.meta.url), "utf8");
  assert.doesNotMatch(src, /sendTelegramAlert\(|placeOrder|executeOrder|STRONG BUY CE|STRONG BUY PE/);
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Hono } from "hono";
import {
  allowedReviewTransition,
  mountSourceTruthRevisionReviewRoutes,
  reviewEventId,
  revisionReviewSchemaSql,
  revisionReviewWorkflowSafetyContract,
  validateRevisionReviewRequest,
} from "../source-truth-revision-review.js";

const revisionId = "b".repeat(64);

test("review request validates exact revision id and allowed actions", () => {
  assert.equal(validateRevisionReviewRequest({ revisionId, action: "approve", note: "checked" }).ok, true);
  assert.deepEqual(validateRevisionReviewRequest({ revisionId: "bad", action: "APPROVE" }), { ok: false, reason: "INVALID_REVISION_ID" });
  assert.deepEqual(validateRevisionReviewRequest({ revisionId, action: "RESET" }), { ok: false, reason: "INVALID_REVIEW_ACTION" });
});

test("review transition state machine is narrow and irreversible except explicit supersede", () => {
  assert.equal(allowedReviewTransition("UNREVIEWED", "APPROVE"), "APPROVED");
  assert.equal(allowedReviewTransition("UNREVIEWED", "REJECT"), "REJECTED");
  assert.equal(allowedReviewTransition("APPROVED", "SUPERSEDE"), "SUPERSEDED");
  assert.equal(allowedReviewTransition("APPROVED", "REJECT"), null);
  assert.equal(allowedReviewTransition("REJECTED", "APPROVE"), null);
  assert.equal(allowedReviewTransition("SUPERSEDED", "APPROVE"), null);
});

test("review event id is deterministic and actor-sensitive", () => {
  const a = reviewEventId({ revisionId, action: "APPROVE", reviewer: "reviewer-a", note: "ok" });
  const b = reviewEventId({ revisionId, action: "APPROVE", reviewer: "reviewer-a", note: "ok" });
  const c = reviewEventId({ revisionId, action: "APPROVE", reviewer: "reviewer-b", note: "ok" });
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.match(a, /^[a-f0-9]{64}$/);
});

test("review schema preserves append-only review events", () => {
  const sql = revisionReviewSchemaSql();
  assert.match(sql, /CREATE TABLE IF NOT EXISTS source_truth_revision_review_log/);
  assert.match(sql, /event_id TEXT PRIMARY KEY/);
  assert.doesNotMatch(sql, /UPDATE\s+source_truth_observation_1m|DELETE\s+FROM\s+source_truth_observation_1m/i);
});

test("approval SQL supersedes older approved correction for the same original observation", () => {
  const source = readFileSync(new URL("../source-truth-revision-review.ts", import.meta.url), "utf8");
  assert.match(source, /review_state = 'SUPERSEDED'/);
  assert.match(source, /supersedes_observation_id = \$3/);
  assert.match(source, /review_state = 'APPROVED'/);
  assert.match(source, /INSERT INTO source_truth_revision_review_log/);
});

test("review workflow is disabled without dedicated review token", async () => {
  const old = process.env.SOURCE_TRUTH_REVIEW_TOKEN;
  delete process.env.SOURCE_TRUTH_REVIEW_TOKEN;
  try {
    const app = new Hono();
    mountSourceTruthRevisionReviewRoutes(app);
    const res = await app.request("http://localhost/api/source-truth/revisions/review", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ revisionId, action: "APPROVE" }),
    });
    assert.equal(res.status, 503);
    const body = await res.json() as { reason?: string };
    assert.equal(body.reason, "SOURCE_TRUTH_REVIEW_DISABLED");
  } finally {
    if (old === undefined) delete process.env.SOURCE_TRUTH_REVIEW_TOKEN;
    else process.env.SOURCE_TRUTH_REVIEW_TOKEN = old;
  }
});

test("wrong review token is rejected before database mutation", async () => {
  const old = process.env.SOURCE_TRUTH_REVIEW_TOKEN;
  process.env.SOURCE_TRUTH_REVIEW_TOKEN = "expected";
  try {
    const app = new Hono();
    mountSourceTruthRevisionReviewRoutes(app);
    const res = await app.request("http://localhost/api/source-truth/revisions/review", {
      method: "POST",
      headers: { "content-type": "application/json", "x-source-truth-review-token": "wrong" },
      body: JSON.stringify({ revisionId, action: "APPROVE" }),
    });
    assert.equal(res.status, 403);
    const body = await res.json() as { reason?: string };
    assert.equal(body.reason, "SOURCE_TRUTH_REVIEW_FORBIDDEN");
  } finally {
    if (old === undefined) delete process.env.SOURCE_TRUTH_REVIEW_TOKEN;
    else process.env.SOURCE_TRUTH_REVIEW_TOKEN = old;
  }
});

test("Phase 44 safety contract keeps approval out of production decisions", () => {
  const contract = revisionReviewWorkflowSafetyContract();
  assert.equal(contract.originalKnownThenImmutable, true);
  assert.equal(contract.reviewEventsAppendOnly, true);
  assert.equal(contract.approvedScope, "KNOWN_LATER_ANALYTICS_ONLY");
  assert.equal(contract.affectsVerdict, false);
  assert.equal(contract.affectsTelegram, false);
  assert.equal(contract.affectsExecution, false);
});

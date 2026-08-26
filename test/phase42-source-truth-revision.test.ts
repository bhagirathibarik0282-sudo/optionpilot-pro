import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Hono } from "hono";
import {
  mountSourceTruthRevisionRoutes,
  sourceTruthPayloadHash,
  sourceTruthRevisionId,
  sourceTruthRevisionSchemaSql,
  validateSourceTruthRevisionRequest,
} from "../source-truth-revision.js";

const observationId = "a".repeat(64);
const request = {
  supersedesObservationId: observationId,
  reasonCode: "IDENTITY_CORRECTION",
  correctionClass: "IDENTITY" as const,
  correctedPayload: { identity_state: "VALID", token: 12345, expiry: "2026-08-27" },
  note: "Independent instrument-master cross-check corrected the identity state.",
};

test("revision hash is deterministic and changes when corrected payload changes", () => {
  const a = sourceTruthRevisionId(request);
  const b = sourceTruthRevisionId({ ...request });
  const c = sourceTruthRevisionId({ ...request, correctedPayload: { ...request.correctedPayload, token: 99999 } });
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.match(a, /^[a-f0-9]{64}$/);
});

test("payload hash is canonical across object key order", () => {
  assert.equal(sourceTruthPayloadHash({ a: 1, b: 2 }), sourceTruthPayloadHash({ b: 2, a: 1 }));
});

test("revision request requires exact observation id, bounded reason and object payload", () => {
  assert.equal(validateSourceTruthRevisionRequest(request).ok, true);
  assert.deepEqual(validateSourceTruthRevisionRequest({ ...request, supersedesObservationId: "bad" }), { ok: false, reason: "INVALID_SUPERSEDES_OBSERVATION_ID" });
  assert.deepEqual(validateSourceTruthRevisionRequest({ ...request, reasonCode: "x" }), { ok: false, reason: "INVALID_REVISION_REASON_CODE" });
  assert.deepEqual(validateSourceTruthRevisionRequest({ ...request, correctedPayload: [] }), { ok: false, reason: "INVALID_CORRECTED_PAYLOAD" });
});

test("revision schema is additive and append-only", () => {
  const sql = sourceTruthRevisionSchemaSql();
  assert.match(sql, /ALTER TABLE source_truth_revision_log/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS revision_id/);
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS idx_source_truth_revision_id/);
  assert.doesNotMatch(sql, /DROP TABLE|TRUNCATE|DELETE FROM|UPDATE source_truth_observation_1m/i);
});

test("revision implementation never updates or deletes the original known-then observation", () => {
  const source = readFileSync(new URL("../source-truth-revision.ts", import.meta.url), "utf8");
  assert.match(source, /SELECT \* FROM source_truth_observation_1m WHERE observation_id = \$1/);
  assert.match(source, /INSERT INTO source_truth_revision_log/);
  assert.doesNotMatch(source, /UPDATE\s+source_truth_observation_1m/i);
  assert.doesNotMatch(source, /DELETE\s+FROM\s+source_truth_observation_1m/i);
  assert.match(source, /originalObservationMutated: false/);
  assert.match(source, /autoAppliedToEvidence: false/);
  assert.match(source, /affectsVerdict: false/);
  assert.match(source, /affectsTelegram: false/);
  assert.match(source, /affectsExecution: false/);
});

test("revision mutation endpoint is disabled when token is absent", async () => {
  const old = process.env.SOURCE_TRUTH_REVISION_TOKEN;
  delete process.env.SOURCE_TRUTH_REVISION_TOKEN;
  try {
    const app = new Hono();
    mountSourceTruthRevisionRoutes(app);
    const res = await app.request("http://localhost/api/source-truth/revisions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });
    assert.equal(res.status, 503);
    const body = await res.json() as { reason?: string };
    assert.equal(body.reason, "SOURCE_TRUTH_REVISIONS_DISABLED");
  } finally {
    if (old === undefined) delete process.env.SOURCE_TRUTH_REVISION_TOKEN;
    else process.env.SOURCE_TRUTH_REVISION_TOKEN = old;
  }
});

test("revision mutation endpoint rejects wrong token before touching DB", async () => {
  const old = process.env.SOURCE_TRUTH_REVISION_TOKEN;
  process.env.SOURCE_TRUTH_REVISION_TOKEN = "expected";
  try {
    const app = new Hono();
    mountSourceTruthRevisionRoutes(app);
    const res = await app.request("http://localhost/api/source-truth/revisions", {
      method: "POST",
      headers: { "content-type": "application/json", "x-source-truth-revision-token": "wrong" },
      body: JSON.stringify(request),
    });
    assert.equal(res.status, 403);
    const body = await res.json() as { reason?: string };
    assert.equal(body.reason, "SOURCE_TRUTH_REVISION_FORBIDDEN");
  } finally {
    if (old === undefined) delete process.env.SOURCE_TRUTH_REVISION_TOKEN;
    else process.env.SOURCE_TRUTH_REVISION_TOKEN = old;
  }
});

test("storage health mount includes revision routes without production side effects", () => {
  const source = readFileSync(new URL("../storage-health.ts", import.meta.url), "utf8");
  assert.match(source, /mountSourceTruthRevisionRoutes\(app\)/);
  assert.doesNotMatch(source, /sendTelegramAlert\(|placeOrder|executeOrder/);
});

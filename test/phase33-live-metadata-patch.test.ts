import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyPhase33LiveMetadataPatch } from "../scripts/phase33-live-metadata-patch-core.mjs";

const server = readFileSync(new URL("../server.ts", import.meta.url), "utf8");

test("Phase 33 patch safely finds current futures anchors", () => {
  const out = applyPhase33LiveMetadataPatch(server);
  assert.equal(out.changed, true, out.reason);
  assert.ok(out.source.includes("PHASE33_FUTURES_LIVE_METADATA"));
  assert.ok(out.source.includes("instrumentToken: Number.isFinite(f.instrument_token) ? f.instrument_token : null"));
  assert.ok(out.source.includes("exchangeToken: Number.isFinite(f.exchange_token) ? f.exchange_token : null"));
  assert.ok(out.source.includes("segment: f.segment || null"));
  assert.ok(out.source.includes("receivedAt: futQuotesReceivedAt"));
  assert.ok(out.source.includes("backend time immediately after the futures quote batch returned"));
});

test("Phase 33 patch is idempotent", () => {
  const once = applyPhase33LiveMetadataPatch(server);
  assert.equal(once.changed, true, once.reason);
  const twice = applyPhase33LiveMetadataPatch(once.source);
  assert.equal(twice.changed, false);
  assert.equal(twice.reason, "ALREADY_PATCHED");
  assert.equal(twice.source, once.source);
});

test("Phase 33 fails closed when anchors are absent", () => {
  const out = applyPhase33LiveMetadataPatch("const unrelated = true;");
  assert.equal(out.changed, false);
  assert.match(out.reason, /^AMBIGUOUS_ANCHORS/);
});

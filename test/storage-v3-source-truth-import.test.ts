import test from "node:test";
import assert from "node:assert/strict";
import { persistStorageV3FromExistingSnapshot } from "../storage-v3-adapter.js";
import { persistStorageV3Minute, minuteBucketUtcIso } from "../storage-v3-writer.js";

test("Storage V3 source-truth wiring modules load without side effects", () => {
  assert.equal(typeof persistStorageV3FromExistingSnapshot, "function");
  assert.equal(typeof persistStorageV3Minute, "function");
  assert.equal(minuteBucketUtcIso("2026-08-26T04:00:59.999Z"), "2026-08-26T04:00:00.000Z");
});

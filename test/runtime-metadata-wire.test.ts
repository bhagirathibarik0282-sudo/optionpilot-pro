import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const wire = readFileSync(new URL("../scripts/wire-storage-v3-runtime.mjs", import.meta.url), "utf8");
const server = readFileSync(new URL("../server.ts", import.meta.url), "utf8");
const snapshotAnchor = "    session.marketSnapshot = snapshot;\n    session.snapshotTime = Date.now();";

test("runtime storage wiring declares Kite source and snapshot receipt proxy", () => {
  assert.ok(wire.includes('sourceProvider: \\\"KITE\\\"'));
  assert.ok(wire.includes('KITE_INDEX_SNAPSHOT_RECEIPT_PROXY'));
  assert.ok(wire.includes('KITE_FUTURES_SNAPSHOT_RECEIPT_PROXY'));
});

test("runtime option rows retain LIVE_CONTRACT_MASTER provenance in sourceVersion", () => {
  assert.ok(wire.includes('row.contractRegime === \\\"LIVE_CONTRACT_MASTER\\\"'));
  assert.ok(wire.includes('KITE_LIVE_CONTRACT_MASTER|SNAPSHOT_RECEIPT_PROXY'));
});

test("runtime chain context does not invent a provider source timestamp", () => {
  assert.ok(wire.includes('sourceTimestamp: null'));
});

test("runtime wiring still states no extra Kite request or trading side effect", () => {
  assert.ok(wire.includes('No extra Kite request'));
  assert.ok(wire.includes('no scoring/verdict/Telegram/execution side effect'));
});

test("current server has exactly one runtime snapshot anchor for safe patching", () => {
  const count = server.split(snapshotAnchor).length - 1;
  assert.equal(count, 1);
});

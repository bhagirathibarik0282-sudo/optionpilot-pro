import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../server.ts", import.meta.url), "utf8");
const wiring = fs.readFileSync(new URL("../scripts/wire-telegram-fingerprint-runtime.mjs", import.meta.url), "utf8");
const start = source.indexOf("async function runTelegramFastCycle(): Promise<void>");
const end = source.indexOf("\n}\n\n// 2026-08-18: periodic \"what changed / what didn't\" summary", start);
const body = start >= 0 && end > start ? source.slice(start, end) : "";

test("Telegram fast wiring targets the exact browser-only fast-cycle blocker", () => {
  assert.notEqual(start, -1, "runTelegramFastCycle must exist");
  assert.ok(end > start, "runTelegramFastCycle boundary must be found");
  assert.match(body, /for \(const s of sessions\.values\(\)\)/);
  assert.match(body, /if \(!activeSession\) return;[\s\S]*const symbols:/);
  assert.match(wiring, /Telegram fast persisted authority fallback/);
});

test("wired fallback is persisted, expiry-gated, ephemeral, and order-free", () => {
  const marker = wiring.indexOf("TELEGRAM_FAST_PERSISTED_AUTHORITY_FALLBACK_V1");
  const fallback = marker >= 0 ? wiring.slice(marker, wiring.indexOf('\";', marker)) : "";

  assert.ok(marker >= 0, "persisted authority fallback marker must exist");
  assert.match(fallback, /phase62RestoredKiteAuthority \?\? \(await resolveKiteAuthoritySession\(\)\)\.session/);
  assert.match(fallback, /authority\.expiresAt > Date\.now\(\)/);
  assert.match(fallback, /if \(!activeSession\) return/);
  assert.doesNotMatch(fallback, /sessions\.set\(/, "ephemeral authority must not become a browser session");
  assert.doesNotMatch(fallback, /placeOrder|executeOrder|createOrder|modifyOrder/i, "fallback must not gain order authority");
});

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const hook = fs.readFileSync(new URL("../research-server-hook.ts", import.meta.url), "utf8");

test("exact shadow startup status route cannot grant live packet or execution proof", () => {
  assert.match(hook, /\/api\/research\/h1-exact-shadow-live-status/);
  assert.match(hook, /loadLatestH1ExactShadowLiveStatus\(\)/);
  assert.match(hook, /livePacketProofGranted:\s*false/);
  assert.match(hook, /STARTUP_STATE_ONLY_NOT_LIVE_PACKET_PROOF/);
  assert.match(hook, /affectsTelegram:\s*false/);
  assert.match(hook, /affectsExecution:\s*false/);
  assert.match(hook, /createsOrders:\s*false/);
  assert.match(hook, /failClosed:\s*true/);
});

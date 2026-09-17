import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("production start no longer launches H1 exact shadow as a separate process", () => {
  const pkg = JSON.parse(readFileSync(new URL("package.json", root), "utf8"));
  const start = String(pkg.scripts?.start ?? "");
  assert.doesNotMatch(start, /&\s*tsx h1-exact-shadow-live-service\.ts/);
  assert.match(start, /tsx server\.ts/);
});

test("server owns the H1 exact shadow startup inside its process with containment", () => {
  const source = readFileSync(new URL("server.ts", root), "utf8");
  assert.match(source, /import \{ startH1ExactShadowLiveService \} from "\.\/h1-exact-shadow-live-service\.js"/);
  assert.match(source, /SAME_PROCESS_H1_EXACT_SHADOW_HOST_V1/);
  assert.match(source, /await startH1ExactShadowLiveService\(\)/);
  assert.match(source, /\[H1_EXACT_SHADOW_HOST\] startup contained:/);
});

test("same-process hosting does not enable the exact or Gold shadow flags", () => {
  const source = readFileSync(new URL("server.ts", root), "utf8");
  assert.doesNotMatch(source, /KITE_H1_EXACT_SHADOW_ENABLED\s*=/);
  assert.doesNotMatch(source, /H1_GOLD_CHASE_SHADOW_ENABLED\s*=/);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("production start no longer launches H1 exact shadow as a separate process", () => {
  const pkg = JSON.parse(readFileSync(new URL("package.json", root), "utf8"));
  const start = String(pkg.scripts?.start ?? "");
  assert.doesNotMatch(start, /&\s*tsx h1-exact-shadow-live-service\.ts/);
  assert.match(start, /tsx h1-same-process-server-entry\.ts/);
});

test("one entrypoint owns exact shadow and server import in the same process", () => {
  const source = readFileSync(new URL("h1-same-process-server-entry.ts", root), "utf8");
  assert.match(source, /import \{ startH1ExactShadowLiveService \} from "\.\/h1-exact-shadow-live-service\.js"/);
  assert.match(source, /await startH1ExactShadowLiveService\(\)/);
  assert.match(source, /\[H1_EXACT_SHADOW_HOST\] startup contained:/);
  assert.match(source, /await import\("\.\/server\.js"\)/);
});

test("same-process hosting does not enable the exact or Gold shadow flags", () => {
  const source = readFileSync(new URL("h1-same-process-server-entry.ts", root), "utf8");
  assert.doesNotMatch(source, /KITE_H1_EXACT_SHADOW_ENABLED\s*=/);
  assert.doesNotMatch(source, /H1_GOLD_CHASE_SHADOW_ENABLED\s*=/);
});

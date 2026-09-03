import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("runtime bridge keeps calculationVersion third and candidate evidence fourth", () => {
  const source = fs.readFileSync(new URL("../h1-runtime-bridge.ts", import.meta.url), "utf8");
  assert.match(source, /calculationVersion = H1_RUNTIME_BRIDGE_VERSION,\s*runtimeCandidateDecisions\?: unknown/);
  assert.match(source, /bindH1ForwardCandidateDecisions\(runtimeCandidateDecisions\)/);
  assert.match(source, /candidateKeys: symbolCandidateKeys/);
});

test("runtime bridge persists explicit selector decisions and does not infer them", () => {
  const source = fs.readFileSync(new URL("../h1-runtime-bridge.ts", import.meta.url), "utf8");
  assert.match(source, /H1_EXECUTION_CANDIDATE_DECISION/);
  assert.match(source, /decision\.reasonCodes/);
  assert.match(source, /decision\.gates \?\? null/);
  assert.doesNotMatch(source, /premiumResponseConfirmed\s*=/);
});

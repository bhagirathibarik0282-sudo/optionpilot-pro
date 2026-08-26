import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { applyPhase46ChainUniversePatch, PHASE46_MARKER } from "../scripts/phase46-chain-universe-patch-core.mjs";

const server = readFileSync(new URL("../server.ts", import.meta.url), "utf8");

test("Phase 46 patch captures master universe and quote coverage without extra broker request", () => {
  const result = applyPhase46ChainUniversePatch(server);
  assert.equal(result.changed, true);
  assert.match(result.source, new RegExp(PHASE46_MARKER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(result.source, /expectedContractCount: allInstruments\.length/);
  assert.match(result.source, /quotedContractCount: phase46Rows\.filter/);
  assert.match(result.source, /fullChainVolumePcr: phase46FullChainVolumePcr/);
  assert.match(result.source, /fullChainCallWallStrike: phase46CallWall\.strike/);
  assert.match(result.source, /phase46ChainTruth = chainStats\.phase46Universe/);
  const beforeFetches = (server.match(/fetchKiteQuoteBatched\(/g) ?? []).length;
  const afterFetches = (result.source.match(/fetchKiteQuoteBatched\(/g) ?? []).length;
  assert.equal(afterFetches, beforeFetches, "patch must reuse existing quote batch, not add broker calls");
});

test("Phase 46 patch is idempotent and generated server remains syntactically valid", () => {
  const first = applyPhase46ChainUniversePatch(server);
  const second = applyPhase46ChainUniversePatch(first.source);
  assert.equal(second.changed, false);
  assert.equal(second.source, first.source);
  const tmp = `/tmp/optionpilot-phase46-${process.pid}.ts`;
  writeFileSync(tmp, first.source, "utf8");
  const checked = spawnSync(process.execPath, ["--check", tmp], { encoding:"utf8" });
  try { assert.equal(checked.status, 0, checked.stderr || checked.stdout); }
  finally { unlinkSync(tmp); }
});

test("startup order runs Phase 46 patch before Storage V3 runtime wiring", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const start = String(pkg.scripts.start);
  assert.ok(start.indexOf("phase33-live-metadata-patch.mjs") < start.indexOf("phase46-chain-universe-patch.mjs"));
  assert.ok(start.indexOf("phase46-chain-universe-patch.mjs") < start.indexOf("wire-storage-v3-runtime.mjs"));
});

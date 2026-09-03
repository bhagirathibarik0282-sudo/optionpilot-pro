#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const PATCH_VERSION = "H1_SELECTOR_REGISTRY_WIRING_V1";
const serverPath = path.join(process.cwd(), "server.ts");
const checkOnly = new Set(process.argv.slice(2)).has("--check");

function count(text, needle) {
  let n = 0;
  let i = 0;
  while ((i = text.indexOf(needle, i)) !== -1) {
    n += 1;
    i += needle.length;
  }
  return n;
}

function fail(message) {
  console.error(`[H1-SELECTOR-WIRE] FAIL: ${message}`);
  process.exitCode = 2;
}

if (!fs.existsSync(serverPath)) {
  fail("server.ts not found");
} else {
  const source = fs.readFileSync(serverPath, "utf8");
  const bridgeImport = 'import { recordH1FromRuntimeSnapshot } from "./h1-runtime-bridge.js";';
  const registryImport = 'import { collectH1LiveSelectorDecisions } from "./h1-live-selector-registry.js";';
  const oldCall = "recordH1FromRuntimeSnapshot(snapshot, h1TruthBySymbol)";
  const already = source.includes(PATCH_VERSION);

  const checks = {
    patchVersion: PATCH_VERSION,
    already,
    bridgeImportCount: count(source, bridgeImport),
    registryImportCount: count(source, registryImport),
    oldCallCount: count(source, oldCall),
    truthMapCount: count(source, "const h1TruthBySymbol = { NIFTY: niftyTruth, BANKNIFTY: bankTruth, SENSEX: sensexTruth };"),
  };
  console.log(JSON.stringify(checks, null, 2));

  if (already) {
    console.log("[H1-SELECTOR-WIRE] already wired");
  } else if (checks.bridgeImportCount !== 1) {
    fail(`expected one H1 bridge import, found ${checks.bridgeImportCount}`);
  } else if (checks.registryImportCount !== 0) {
    fail(`unexpected pre-existing registry import count ${checks.registryImportCount}`);
  } else if (checks.oldCallCount !== 1) {
    fail(`expected one existing H1 recorder call, found ${checks.oldCallCount}`);
  } else if (checks.truthMapCount !== 1) {
    fail(`expected one verified H1 truth map, found ${checks.truthMapCount}`);
  } else if (checkOnly) {
    console.log("[H1-SELECTOR-WIRE] CHECK PASS: exact anchors verified");
  } else {
    let patched = source.replace(bridgeImport, `${bridgeImport}\n${registryImport}`);
    patched = patched.replace(
      oldCall,
      `(() => {\n      // ${PATCH_VERSION}: consume only fresh LIVE_RUNTIME_EXACT selector evidence.\n      const h1Selector = collectH1LiveSelectorDecisions(new Date().toISOString());\n      const h1CandidateDecisions = h1Selector.eligibleForLiveH1Marking ? h1Selector.decisions : undefined;\n      return recordH1FromRuntimeSnapshot(snapshot, h1TruthBySymbol, undefined, h1CandidateDecisions);\n    })()`,
    );

    const post = {
      markerCount: count(patched, PATCH_VERSION),
      registryImportCount: count(patched, registryImport),
      oldCallCount: count(patched, oldCall),
      fourArgCallCount: count(patched, "recordH1FromRuntimeSnapshot(snapshot, h1TruthBySymbol, undefined, h1CandidateDecisions)"),
      selectorCollectCount: count(patched, "collectH1LiveSelectorDecisions(new Date().toISOString())"),
    };
    console.log(JSON.stringify(post, null, 2));
    if (post.markerCount !== 1 || post.registryImportCount !== 1 || post.oldCallCount !== 0 || post.fourArgCallCount !== 1 || post.selectorCollectCount !== 1) {
      fail("post-patch invariants failed; refusing to write server.ts");
    } else {
      fs.writeFileSync(serverPath, patched, "utf8");
      console.log("[H1-SELECTOR-WIRE] server.ts patched; run tests before commit");
    }
  }
}

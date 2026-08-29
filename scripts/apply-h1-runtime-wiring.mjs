#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const PATCH_VERSION = "H1_RUNTIME_PATCH_V2";
const ROOT = process.cwd();
const serverPath = path.join(ROOT, "server.ts");
const backupPath = path.join(ROOT, "server.ts.h1-prewire.bak");
const args = new Set(process.argv.slice(2));
const checkOnly = args.has("--check");

function fail(message) {
  console.error(`[H1-WIRE] FAIL: ${message}`);
  process.exitCode = 2;
  return null;
}

function count(text, needle) {
  let n = 0;
  let i = 0;
  while ((i = text.indexOf(needle, i)) !== -1) {
    n += 1;
    i += needle.length;
  }
  return n;
}

if (!fs.existsSync(serverPath)) {
  fail(`server.ts not found at ${serverPath}`);
} else {
  const source = fs.readFileSync(serverPath, "utf8");
  const importAnchor = 'import { dbInit, dbInsert, dbLoadRecent, dbIsConfigured } from "./db.js";';
  const truthAnchor = [
    "    const niftyTruth = computeTruthReport(niftyMetricsForTruth);",
    "    const bankTruth = computeTruthReport(bankMetricsForTruth);",
    "    const sensexTruth = computeTruthReport(snapshot.SENSEX);",
  ].join("\n");
  const alreadyWired = source.includes(PATCH_VERSION) || source.includes("H1_TRUTH_BY_SYMBOL_V1");

  const checks = {
    patchVersion: PATCH_VERSION,
    serverPath,
    alreadyWired,
    dbImportAnchorCount: count(source, importAnchor),
    dbInitAwaitCount: (source.match(/\bawait\s+dbInit\(\);/g) ?? []).length,
    verifiedTruthAnchorCount: count(source, truthAnchor),
    truthReportShapePresent: source.includes('overallVerdict: TruthVerdict;'),
    recorderSnapshotVariablesPresent:
      source.includes("const niftyMetricsForTruth = snapshot.NIFTY;") &&
      source.includes("const bankMetricsForTruth = snapshot.BANKNIFTY;"),
  };

  console.log(JSON.stringify(checks, null, 2));

  if (alreadyWired) {
    console.log("[H1-WIRE] already wired; no change required.");
  } else if (checks.dbImportAnchorCount !== 1) {
    fail(`expected exactly one DB import anchor, found ${checks.dbImportAnchorCount}`);
  } else if (checks.dbInitAwaitCount !== 1) {
    fail(`expected exactly one awaited dbInit() anchor, found ${checks.dbInitAwaitCount}`);
  } else if (checks.verifiedTruthAnchorCount !== 1) {
    fail(`expected exactly one verified recorder Truth block, found ${checks.verifiedTruthAnchorCount}`);
  } else if (!checks.truthReportShapePresent) {
    fail("TruthReport.overallVerdict shape not found; refusing to infer a different Truth schema");
  } else if (!checks.recorderSnapshotVariablesPresent) {
    fail("verified recorder snapshot variables are absent; refusing to guess a different hook scope");
  } else if (checkOnly) {
    console.log("[H1-WIRE] CHECK ONLY PASS: exact recorder Truth scope verified; write mode may proceed.");
  } else {
    const importReplacement = `${importAnchor}\nimport { ensureH1DerivedSchema } from "./h1-derived-db.js";\nimport { recordH1FromRuntimeSnapshot } from "./h1-runtime-bridge.js";`;
    let patched = source.replace(importAnchor, importReplacement);

    patched = patched.replace(
      /\bawait\s+dbInit\(\);/,
      `await dbInit();\n  void ensureH1DerivedSchema().catch((err) => console.error("[H1] derived schema init failed (live path unaffected):", err instanceof Error ? err.message : err));`,
    );

    const hook = `${truthAnchor}\n\n    // H1_TRUTH_BY_SYMBOL_V1 / ${PATCH_VERSION}: research-only, fail-open side-channel.\n    // Reuse the exact TruthReport objects already computed by the existing recorder cycle.\n    const h1TruthBySymbol = { NIFTY: niftyTruth, BANKNIFTY: bankTruth, SENSEX: sensexTruth };\n    void recordH1FromRuntimeSnapshot(snapshot, h1TruthBySymbol).catch((err) =>\n      console.error("[H1] recorder bridge failed (live path unaffected):", err instanceof Error ? err.message : err),\n    );`;
    patched = patched.replace(truthAnchor, hook);

    const postChecks = {
      importBridgeCount: count(patched, 'import { recordH1FromRuntimeSnapshot } from "./h1-runtime-bridge.js";'),
      importSchemaCount: count(patched, 'import { ensureH1DerivedSchema } from "./h1-derived-db.js";'),
      h1TruthMapCount: count(patched, "const h1TruthBySymbol = { NIFTY: niftyTruth, BANKNIFTY: bankTruth, SENSEX: sensexTruth };"),
      runtimeCallCount: count(patched, "recordH1FromRuntimeSnapshot(snapshot, h1TruthBySymbol)"),
      patchMarkerCount: count(patched, PATCH_VERSION),
    };

    if (
      postChecks.importBridgeCount !== 1 ||
      postChecks.importSchemaCount !== 1 ||
      postChecks.h1TruthMapCount !== 1 ||
      postChecks.runtimeCallCount !== 1 ||
      postChecks.patchMarkerCount !== 1
    ) {
      console.error(JSON.stringify(postChecks, null, 2));
      fail("post-patch invariants failed; refusing to write server.ts");
    } else if (patched === source) {
      fail("patch produced no change");
    } else {
      if (!fs.existsSync(backupPath)) fs.writeFileSync(backupPath, source, "utf8");
      fs.writeFileSync(serverPath, patched, "utf8");
      console.log(JSON.stringify(postChecks, null, 2));
      console.log(`[H1-WIRE] PATCHED ${serverPath}`);
      console.log(`[H1-WIRE] backup: ${backupPath}`);
      console.log("[H1-WIRE] next mandatory step: npm test. Do not deploy on patch success alone.");
    }
  }
}

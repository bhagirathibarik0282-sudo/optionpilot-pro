#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const PATCH_VERSION = "H1_RUNTIME_PATCH_V1";
const ROOT = process.cwd();
const serverPath = path.join(ROOT, "server.ts");
const backupPath = path.join(ROOT, "server.ts.h1-prewire.bak");
const args = new Set(process.argv.slice(2));
const checkOnly = args.has("--check");
const truthArg = process.argv.slice(2).find((x) => x.startsWith("--truth-expr="));
const truthExpr = truthArg ? truthArg.slice("--truth-expr=".length).trim() : "";

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

function detectTruthCandidates(source) {
  const names = new Set();
  const patterns = [
    /\b(?:const|let)\s+([A-Za-z_$][\w$]*(?:truth|Truth|quality|Quality)[\w$]*)\s*=/g,
    /\b([A-Za-z_$][\w$]*(?:truthReport|truthResult|dataTruth|truthBySymbol|qualityReport)[\w$]*)\b/g,
  ];
  for (const rx of patterns) {
    let m;
    while ((m = rx.exec(source))) names.add(m[1]);
  }
  return [...names].slice(0, 20);
}

if (!fs.existsSync(serverPath)) {
  fail(`server.ts not found at ${serverPath}`);
} else {
  const source = fs.readFileSync(serverPath, "utf8");
  const importAnchor = 'import { dbInit, dbInsert, dbLoadRecent, dbIsConfigured } from "./db.js";';
  const snapshotAnchor = "session.marketSnapshot =";
  const alreadyWired = source.includes("H1_RUNTIME_PATCH_V1") || source.includes("recordH1FromRuntimeSnapshot");
  const truthCandidates = detectTruthCandidates(source);

  const checks = {
    patchVersion: PATCH_VERSION,
    serverPath,
    alreadyWired,
    dbImportAnchorCount: count(source, importAnchor),
    dbInitAwaitCount: (source.match(/\bawait\s+dbInit\(\);/g) ?? []).length,
    snapshotAssignmentCount: count(source, snapshotAnchor),
    truthCandidates,
    truthExpressionProvided: !!truthExpr,
  };

  console.log(JSON.stringify(checks, null, 2));

  if (alreadyWired) {
    console.log("[H1-WIRE] already wired; no change required.");
  } else if (checks.dbImportAnchorCount !== 1) {
    fail(`expected exactly one DB import anchor, found ${checks.dbImportAnchorCount}`);
  } else if (checks.dbInitAwaitCount !== 1) {
    fail(`expected exactly one awaited dbInit() anchor, found ${checks.dbInitAwaitCount}`);
  } else if (checks.snapshotAssignmentCount < 1) {
    fail("could not locate session.marketSnapshot assignment; refusing to guess a runtime hook location");
  } else if (checkOnly) {
    if (!truthExpr) {
      console.log("[H1-WIRE] CHECK ONLY: structural anchors pass. Supply --truth-expr=<existing Truth expression> for write mode.");
      if (truthCandidates.length) console.log(`[H1-WIRE] candidate Truth identifiers: ${truthCandidates.join(", ")}`);
    } else {
      console.log(`[H1-WIRE] CHECK ONLY: ready to patch using Truth expression: ${truthExpr}`);
    }
  } else if (!truthExpr) {
    fail("Truth expression was not provided. Refusing to invent a Truth verdict. Re-run with --truth-expr=<existing Truth expression> after --check review.");
  } else {
    // Guard against injecting arbitrary multiline/code payloads through the CLI.
    if (!/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*|\[["'][^"'\n]+["']\])*$/u.test(truthExpr)) {
      fail("--truth-expr must be a simple existing identifier/property expression; executable expressions are forbidden");
    } else {
      const importReplacement = `${importAnchor}\nimport { ensureH1DerivedSchema } from "./h1-derived-db.js";\nimport { recordH1FromRuntimeSnapshot } from "./h1-runtime-bridge.js";`;
      let patched = source.replace(importAnchor, importReplacement);

      patched = patched.replace(
        /\bawait\s+dbInit\(\);/,
        `await dbInit();\n  void ensureH1DerivedSchema().catch((err) => console.error("[H1] derived schema init failed (live path unaffected):", err instanceof Error ? err.message : err));`,
      );

      // Insert immediately after the final marketSnapshot assignment statement. We locate
      // the assignment and the following semicolon rather than replacing the assignment,
      // preserving the exact existing expression and live behavior.
      const lastAssignment = patched.lastIndexOf(snapshotAnchor);
      const semicolon = patched.indexOf(";", lastAssignment);
      if (semicolon === -1) {
        fail("marketSnapshot assignment has no terminating semicolon; refusing unsafe patch");
      } else {
        const hook = `\n      // ${PATCH_VERSION}: research-only, fail-open side-channel.\n      void recordH1FromRuntimeSnapshot(session.marketSnapshot, ${truthExpr}).catch((err) =>\n        console.error("[H1] recorder bridge failed (live path unaffected):", err instanceof Error ? err.message : err),\n      );`;
        patched = patched.slice(0, semicolon + 1) + hook + patched.slice(semicolon + 1);

        if (patched === source) {
          fail("patch produced no change");
        } else {
          if (!fs.existsSync(backupPath)) fs.writeFileSync(backupPath, source, "utf8");
          fs.writeFileSync(serverPath, patched, "utf8");
          console.log(`[H1-WIRE] PATCHED ${serverPath}`);
          console.log(`[H1-WIRE] backup: ${backupPath}`);
          console.log("[H1-WIRE] next mandatory step: npm test. Do not deploy on patch success alone.");
        }
      }
    }
  }
}

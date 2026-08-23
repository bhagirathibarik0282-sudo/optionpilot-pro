import { readFileSync, writeFileSync } from "node:fs";

const path = "server.ts";
const source = readFileSync(path, "utf8");

const honoImport = 'import { Hono } from "hono";';
const mountImport = 'import { mountResearchRoutes } from "./research-server-hook.js";';
const appPatterns = [
  /const\s+app\s*=\s*new\s+Hono\s*\([^\n]*\);?/,
  /let\s+app\s*=\s*new\s+Hono\s*\([^\n]*\);?/,
  /var\s+app\s*=\s*new\s+Hono\s*\([^\n]*\);?/,
];

if (!source.includes(honoImport)) {
  throw new Error("RESEARCH_MOUNT_ABORT: Hono import marker missing");
}
if (source.includes(mountImport) || /mountResearchRoutes\s*\(\s*app\s*\)/.test(source)) {
  throw new Error("RESEARCH_MOUNT_ABORT: mount already present or partially present");
}

const appMatches = appPatterns.flatMap((pattern) => [...source.matchAll(new RegExp(pattern.source, "g"))]);
if (appMatches.length !== 1) {
  throw new Error(`RESEARCH_MOUNT_ABORT: expected exactly one app bootstrap, found ${appMatches.length}`);
}

const appMatch = appMatches[0];
const appLine = appMatch[0];

let next = source.replace(honoImport, `${honoImport}\n${mountImport}`);
next = next.replace(appLine, `${appLine}\nmountResearchRoutes(app);`);

if (next === source) {
  throw new Error("RESEARCH_MOUNT_ABORT: no change produced");
}
if (!next.includes(mountImport) || !/mountResearchRoutes\s*\(\s*app\s*\)\s*;/.test(next)) {
  throw new Error("RESEARCH_MOUNT_ABORT: post-patch verification failed");
}

const dryRun = process.argv.includes("--dry-run");
if (dryRun) {
  console.log(JSON.stringify({
    ok: true,
    mode: "RESEARCH_MODE",
    productionImpact: "NONE",
    dryRun: true,
    appBootstrap: appLine,
    changes: ["mount import", "mountResearchRoutes(app)"],
  }, null, 2));
} else {
  writeFileSync(path, next, "utf8");
  console.log("Research routes mounted into server.ts with fail-closed codemod.");
}

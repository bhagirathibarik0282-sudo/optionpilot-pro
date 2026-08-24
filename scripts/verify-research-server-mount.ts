import { readFileSync } from "node:fs";

const source = readFileSync("server.ts", "utf8");

const importMarker = 'import { Hono } from "hono";';
const mountImport = 'import { mountResearchRoutes } from "./research-server-hook.js";';
const appPatterns = [
  /const\s+app\s*=\s*new\s+Hono\s*\(/,
  /let\s+app\s*=\s*new\s+Hono\s*\(/,
  /var\s+app\s*=\s*new\s+Hono\s*\(/,
];
const mountCall = /mountResearchRoutes\s*\(\s*app\s*\)\s*;/;

const hasHonoImport = source.includes(importMarker);
const appPattern = appPatterns.find((pattern) => pattern.test(source)) ?? null;
const hasMountImport = source.includes(mountImport);
const hasMountCall = mountCall.test(source);

const result = {
  mode: "RESEARCH_MODE",
  productionImpact: "NONE",
  hasHonoImport,
  appBootstrapDetected: !!appPattern,
  alreadyMounted: hasMountImport && hasMountCall,
  mountImportPresent: hasMountImport,
  mountCallPresent: hasMountCall,
  safeToPatch: hasHonoImport && !!appPattern && !hasMountImport && !hasMountCall,
};

console.log(JSON.stringify(result, null, 2));

if (!hasHonoImport || !appPattern) {
  console.error("RESEARCH_SERVER_MOUNT_MARKER_NOT_FOUND: refuse blind server.ts patch");
  process.exitCode = 2;
}

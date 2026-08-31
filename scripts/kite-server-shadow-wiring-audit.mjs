#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const serverPath = path.join(ROOT, "server.ts");
const result = {
  version: "KITE_SERVER_SHADOW_WIRING_AUDIT_V1",
  productionImpact: "NONE",
  checks: {},
  blockers: [],
};

if (!fs.existsSync(serverPath)) {
  result.blockers.push("MISSING:server.ts");
} else {
  const source = fs.readFileSync(serverPath, "utf8");
  result.checks.serverBytes = Buffer.byteLength(source);
  result.checks.honoImport = source.includes('import { Hono } from "hono";');
  result.checks.serveImport = source.includes('import { serve } from "@hono/node-server";');
  result.checks.kiteAuthorityImport = source.includes("kite-session-authority");
  result.checks.existingShadowSupervisorImport = source.includes("kite-runtime-shadow-supervisor");
  result.checks.existingShadowStartupMarker = source.includes("KITE_SERVER_SHADOW_RUNTIME_V1");
  result.checks.hasAppRoutes = /app\.(get|post|put|delete)\(/.test(source);
  result.checks.hasServeCall = /\bserve\s*\(/.test(source);

  if (result.checks.serverBytes < 1000) result.blockers.push("SERVER_TOO_SMALL_FOR_SAFE_PATCH");
  if (!result.checks.honoImport) result.blockers.push("ANCHOR_MISSING:Hono import");
  if (!result.checks.serveImport) result.blockers.push("ANCHOR_MISSING:serve import");
  if (!result.checks.kiteAuthorityImport) result.blockers.push("ANCHOR_MISSING:kite authority");
  if (!result.checks.hasAppRoutes) result.blockers.push("ANCHOR_MISSING:app routes");
  if (!result.checks.hasServeCall) result.blockers.push("ANCHOR_MISSING:serve call");
}

for (const rel of [
  "kite-runtime-shadow-supervisor.ts",
  "kite-immediate-runtime-core.ts",
  "kite-websocket-transport.ts",
  "kite-immediate-token-registry.ts",
]) {
  const ok = fs.existsSync(path.join(ROOT, rel));
  result.checks[rel] = ok;
  if (!ok) result.blockers.push(`MISSING:${rel}`);
}

result.ok = result.blockers.length === 0;
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 2;

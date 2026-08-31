#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const requiredFiles = [
  "kite-immediate-runtime-core.ts",
  "kite-immediate-token-registry.ts",
  "kite-websocket-binary-decoder.ts",
  "docs/KITE_RUNTIME_SHADOW_STARTUP_V1.md",
];

const result = {
  version: "KITE_RUNTIME_SHADOW_PREFLIGHT_V1",
  productionImpact: "NONE",
  checks: {},
  blockers: [],
};

for (const rel of requiredFiles) {
  const ok = fs.existsSync(path.join(ROOT, rel));
  result.checks[rel] = ok;
  if (!ok) result.blockers.push(`MISSING:${rel}`);
}

const serverPath = path.join(ROOT, "server.ts");
const serverExists = fs.existsSync(serverPath);
const serverBytes = serverExists ? fs.statSync(serverPath).size : 0;
result.checks.serverExists = serverExists;
result.checks.serverBytes = serverBytes;

if (!serverExists) result.blockers.push("MISSING:server.ts");
else if (serverBytes === 0) result.blockers.push("EMPTY:server.ts");

const enabled = process.env.KITE_RUNTIME_SHADOW_ENABLED === "true";
result.checks.shadowEnabled = enabled;

if (enabled) {
  const apiKeyPresent = Boolean(process.env.KITE_API_KEY);
  const accessTokenPresent = Boolean(process.env.KITE_ACCESS_TOKEN);
  result.checks.kiteApiKeyPresent = apiKeyPresent;
  result.checks.kiteAccessTokenPresent = accessTokenPresent;
  if (!apiKeyPresent) result.blockers.push("MISSING_ENV:KITE_API_KEY");
  if (!accessTokenPresent) result.blockers.push("MISSING_ENV:KITE_ACCESS_TOKEN");
} else {
  result.checks.failClosedWhenDisabled = true;
}

result.ok = result.blockers.length === 0;
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 2;

#!/usr/bin/env node
import fs from "node:fs";

const required = [
  "kite-runtime-shadow-authority-binding.ts",
  "kite-runtime-shadow-supervisor.ts",
  "kite-session-authority.ts",
  "kite-immediate-token-registry.ts",
  "test/kite-runtime-shadow-authority-binding.test.ts",
];
const blockers = required.filter((p) => !fs.existsSync(p)).map((p) => `MISSING:${p}`);
const binding = fs.existsSync("kite-runtime-shadow-authority-binding.ts") ? fs.readFileSync("kite-runtime-shadow-authority-binding.ts", "utf8") : "";
for (const anchor of ["resolveKiteAuthoritySession", "productionImpact: \"NONE\"", "API_KEY_MISSING", "AUTHORITY_UNAVAILABLE"]) {
  if (!binding.includes(anchor)) blockers.push(`ANCHOR_MISSING:${anchor}`);
}
console.log(JSON.stringify({ version: "KITE_RUNTIME_SHADOW_AUTHORITY_BINDING_AUDIT_V1", ok: blockers.length === 0, blockers, productionImpact: "NONE" }, null, 2));
if (blockers.length) process.exitCode = 2;

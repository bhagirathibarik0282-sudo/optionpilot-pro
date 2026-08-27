import fs from "node:fs";
import { applyPhase59ShadowDiagnosticPatch } from "./phase59-shadow-diagnostic-patch-core.mjs";

const target = process.argv[2] || "server.ts";
const source = fs.readFileSync(target, "utf8");
const result = applyPhase59ShadowDiagnosticPatch(source);
if (result.changed) fs.writeFileSync(target, result.source);
console.log(JSON.stringify({ target, changed: result.changed, marker: "PHASE59_SHADOW_DIAGNOSTIC_TRACE_WIRING_V1" }));

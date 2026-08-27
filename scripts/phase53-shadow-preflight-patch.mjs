import { readFileSync, writeFileSync } from "node:fs";
import { applyPhase53ShadowPreflightPatch } from "./phase53-shadow-preflight-patch-core.mjs";

const path = new URL("../server.ts", import.meta.url);
const source = readFileSync(path, "utf8");
try {
  const result = applyPhase53ShadowPreflightPatch(source);
  if (result.changed) writeFileSync(path, result.source, "utf8");
  console.log(`[Phase53 patch] ${result.changed ? "applied" : "already present"}`);
} catch (err) {
  console.error("[Phase53 patch] fail-closed; server source left unchanged:", err instanceof Error ? err.message : err);
  process.exit(1);
}

import { readFileSync, writeFileSync } from "node:fs";
import { applyPhase51ShadowReadinessPatch } from "./phase51-shadow-readiness-patch-core.mjs";

const path = new URL("../server.ts", import.meta.url);
const source = readFileSync(path, "utf8");
try {
  const result = applyPhase51ShadowReadinessPatch(source);
  if (result.changed) writeFileSync(path, result.source, "utf8");
  console.log(`[Phase51 patch] ${result.changed ? "applied" : "already present"}`);
} catch (err) {
  console.error("[Phase51 patch] fail-closed; server source left unchanged:", err instanceof Error ? err.message : err);
  process.exit(1);
}

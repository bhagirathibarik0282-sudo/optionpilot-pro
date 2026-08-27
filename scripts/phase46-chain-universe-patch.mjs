import { readFileSync, writeFileSync } from "node:fs";
import { applyPhase46ChainUniversePatch } from "./phase46-chain-universe-patch-core.mjs";

const path = new URL("../server.ts", import.meta.url);
const source = readFileSync(path, "utf8");
try {
  const result = applyPhase46ChainUniversePatch(source);
  if (result.changed) writeFileSync(path, result.source, "utf8");
  console.log(`[Phase46 patch] ${result.changed ? "applied" : "already present"}`);
} catch (err) {
  console.error("[Phase46 patch] fail-closed; server source left unchanged:", err instanceof Error ? err.message : err);
  process.exit(1);
}

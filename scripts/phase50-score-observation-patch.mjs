import { readFileSync, writeFileSync } from "node:fs";
import { applyPhase50ScoreObservationPatch } from "./phase50-score-observation-patch-core.mjs";

const path = new URL("../server.ts", import.meta.url);
const source = readFileSync(path, "utf8");
try {
  const result = applyPhase50ScoreObservationPatch(source);
  if (result.changed) writeFileSync(path, result.source, "utf8");
  console.log(`[Phase50 patch] ${result.changed ? "applied" : "already present"}`);
} catch (err) {
  console.error("[Phase50 patch] fail-closed; server source left unchanged:", err instanceof Error ? err.message : err);
  process.exit(1);
}

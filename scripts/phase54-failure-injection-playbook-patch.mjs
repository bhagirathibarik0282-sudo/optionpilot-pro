import { readFileSync, writeFileSync } from "node:fs";
import { applyPhase54FailureInjectionPlaybookPatch } from "./phase54-failure-injection-playbook-patch-core.mjs";

const path = new URL("../server.ts", import.meta.url);
const source = readFileSync(path, "utf8");
try {
  const result = applyPhase54FailureInjectionPlaybookPatch(source);
  if (result.changed) writeFileSync(path, result.source, "utf8");
  console.log(`[Phase54 patch] ${result.changed ? "applied" : "already present"}`);
} catch (err) {
  console.error("[Phase54 patch] fail-closed; server source left unchanged:", err instanceof Error ? err.message : err);
  process.exit(1);
}

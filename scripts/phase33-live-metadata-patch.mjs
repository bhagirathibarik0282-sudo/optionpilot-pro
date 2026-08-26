import { readFileSync, writeFileSync } from "node:fs";
import { applyPhase33LiveMetadataPatch } from "./phase33-live-metadata-patch-core.mjs";

const path = new URL("../server.ts", import.meta.url);
const current = readFileSync(path, "utf8");
const result = applyPhase33LiveMetadataPatch(current);

if (!result.changed && result.reason !== "ALREADY_PATCHED") {
  console.warn(`[Phase 33 metadata patch] ${result.reason}; leaving server.ts unchanged`);
  process.exit(0);
}

if (result.changed) {
  writeFileSync(path, result.source, "utf8");
  console.log("[Phase 33 metadata patch] futures identity + quote-response received_at ready");
} else {
  console.log("[Phase 33 metadata patch] already applied");
}

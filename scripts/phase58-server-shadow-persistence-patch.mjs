import { readFileSync, writeFileSync } from "node:fs";
import { applyPhase58ServerShadowPersistencePatch } from "./phase58-server-shadow-persistence-core.mjs";

const path = process.argv[2] || "server.ts";
const source = readFileSync(path, "utf8");
const result = applyPhase58ServerShadowPersistencePatch(source);
if (result.changed) writeFileSync(path, result.source, "utf8");
console.log(JSON.stringify({ ok: true, changed: result.changed, marker: "PHASE58_SERVER_SHADOW_SCORE_PERSISTENCE_V1" }));

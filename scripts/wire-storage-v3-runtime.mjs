import { readFileSync, writeFileSync } from "node:fs";

const path = new URL("../server.ts", import.meta.url);
let source = readFileSync(path, "utf8");

const IMPORT_MARKER = 'import { persistStorageV3FromExistingSnapshot } from "./storage-v3-adapter.js";';
const DB_IMPORT = 'import { dbInit, dbInsert, dbLoadRecent, dbIsConfigured } from "./db.js";';
const SNAPSHOT_ANCHOR = `    session.marketSnapshot = snapshot;\n    session.snapshotTime = Date.now();`;
const WIRE_MARKER = "// STORAGE_V3_RUNTIME_WIRE_BEGIN";

if (!source.includes(IMPORT_MARKER)) {
  if (!source.includes(DB_IMPORT)) {
    console.warn("[Storage V3 wire] db import anchor not found; leaving server.ts unchanged");
    process.exit(0);
  }
  source = source.replace(DB_IMPORT, `${DB_IMPORT}\n${IMPORT_MARKER}`);
}

if (!source.includes(WIRE_MARKER)) {
  const matches = source.split(SNAPSHOT_ANCHOR).length - 1;
  if (matches !== 1) {
    console.warn(`[Storage V3 wire] expected exactly one snapshot anchor, found ${matches}; leaving runtime persistence unwired`);
    process.exit(0);
  }

  const wiring = `${SNAPSHOT_ANCHOR}\n\n    ${WIRE_MARKER}\n    // Storage-only persistence of data already fetched/calculated by this refresh.\n    // No extra Kite request, no scoring/verdict/Telegram/execution side effect.\n    for (const storageSym of [\"NIFTY\", \"BANKNIFTY\", \"SENSEX\"] as const) {\n      const storageMarket = snapshot[storageSym];\n      if (!storageMarket || storageMarket.error) continue;\n      void persistStorageV3FromExistingSnapshot(storageSym, storageMarket, {\n        oiPcr: storageMarket.pcr,\n        volumePcr: storageMarket.volumePcr,\n        fullChainPcr: storageMarket.gapScore?.fullChainPcr ?? null,\n        maxPain: storageMarket.maxPain,\n      }).then((result) => {\n        if (!result.ok && !result.skipped) {\n          console.warn(\"[Storage V3] write returned not-ok\", storageSym, result.reason ?? \"UNKNOWN\");\n        }\n      }).catch((err) => {\n        console.error(\"[Storage V3] persistence call failed without affecting live cycle:\", err instanceof Error ? err.message : err);\n      });\n    }\n    // STORAGE_V3_RUNTIME_WIRE_END`;

  source = source.replace(SNAPSHOT_ANCHOR, wiring);
}

writeFileSync(path, source, "utf8");
console.log("[Storage V3 wire] runtime storage wiring ready");

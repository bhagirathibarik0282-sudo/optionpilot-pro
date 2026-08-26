import { readFileSync, writeFileSync } from "node:fs";

const path = new URL("../server.ts", import.meta.url);
let source = readFileSync(path, "utf8");

const IMPORT_MARKER = 'import { persistStorageV3FromExistingSnapshot } from "./storage-v3-adapter.js";';
const HEALTH_IMPORT = 'import { mountStorageHealthRoutes } from "./storage-health.js";';
const TEF_INSPECT_IMPORT = 'import { mountTefInspectRoutes } from "./tef-inspect.js";';
const TELEGRAM_PREVIEW_IMPORT = 'import { mountTelegramPreviewRoutes } from "./telegram-preview-route.js";';
const DB_IMPORT = 'import { dbInit, dbInsert, dbLoadRecent, dbIsConfigured } from "./db.js";';
const SNAPSHOT_ANCHOR = `    session.marketSnapshot = snapshot;\n    session.snapshotTime = Date.now();`;
const WIRE_MARKER = "// STORAGE_V3_RUNTIME_WIRE_BEGIN";
const HEALTH_MOUNT_MARKER = "// STORAGE_V3_HEALTH_ROUTE_MOUNT";
const TEF_MOUNT_MARKER = "// TEF_INSPECT_ROUTE_MOUNT";
const TELEGRAM_PREVIEW_MOUNT_MARKER = "// TELEGRAM_PREVIEW_ROUTE_MOUNT";

if (!source.includes(IMPORT_MARKER)) {
  if (!source.includes(DB_IMPORT)) {
    console.warn("[Storage V3 wire] db import anchor not found; leaving server.ts unchanged");
    process.exit(0);
  }
  source = source.replace(DB_IMPORT, `${DB_IMPORT}\n${IMPORT_MARKER}`);
}

if (!source.includes(HEALTH_IMPORT)) source = source.replace(IMPORT_MARKER, `${IMPORT_MARKER}\n${HEALTH_IMPORT}`);
if (!source.includes(TEF_INSPECT_IMPORT)) source = source.replace(HEALTH_IMPORT, `${HEALTH_IMPORT}\n${TEF_INSPECT_IMPORT}`);
if (!source.includes(TELEGRAM_PREVIEW_IMPORT)) source = source.replace(TEF_INSPECT_IMPORT, `${TEF_INSPECT_IMPORT}\n${TELEGRAM_PREVIEW_IMPORT}`);

if (!source.includes(WIRE_MARKER)) {
  const matches = source.split(SNAPSHOT_ANCHOR).length - 1;
  if (matches !== 1) {
    console.warn(`[Storage V3 wire] expected exactly one snapshot anchor, found ${matches}; leaving runtime persistence unwired`);
    process.exit(0);
  }

  const wiring = `${SNAPSHOT_ANCHOR}\n\n    ${WIRE_MARKER}\n    // Storage-only persistence of data already fetched/calculated by this refresh.\n    // Phase 33 carries exact futures master identity and the backend quote-batch\n    // response receipt boundary when available. This is not an exchange timestamp.\n    // No extra Kite request, no scoring/verdict/Telegram/execution side effect.\n    for (const storageSym of [\"NIFTY\", \"BANKNIFTY\", \"SENSEX\"] as const) {\n      const storageMarket = snapshot[storageSym];\n      if (!storageMarket || storageMarket.error) continue;\n\n      const storageReceivedAt = storageMarket.timestamp ?? new Date().toISOString();\n      const storageMarketForTruth = {\n        ...storageMarket,\n        sourceProvider: \"KITE\",\n        receivedAt: storageReceivedAt,\n        sourceVersion: \"KITE_INDEX_SNAPSHOT_RECEIPT_PROXY\",\n        futuresContracts: (storageMarket.futuresContracts ?? []).map((future) => ({\n          ...future,\n          tradingSymbol: future.tradingsymbol ?? null,\n          sourceProvider: \"KITE\",\n          receivedAt: future.receivedAt ?? storageReceivedAt,\n          sourceVersion: future.receivedAt && future.instrumentToken != null && future.segment && future.exchange\n            ? \"KITE_FUTURES_LIVE_CONTRACT_MASTER|QUOTE_RESPONSE_RECEIPT\"\n            : \"KITE_FUTURES_SNAPSHOT_RECEIPT_PROXY\",\n        })),\n        expiries: (storageMarket.expiries ?? []).map((expiry) => ({\n          ...expiry,\n          ceStrikes: (expiry.ceStrikes ?? []).map((row) => ({\n            ...row,\n            sourceProvider: \"KITE\",\n            receivedAt: storageReceivedAt,\n            sourceVersion: row.contractRegime === \"LIVE_CONTRACT_MASTER\"\n              ? \"KITE_LIVE_CONTRACT_MASTER|SNAPSHOT_RECEIPT_PROXY\"\n              : \"KITE_OPTION_SNAPSHOT_RECEIPT_PROXY\",\n          })),\n          peStrikes: (expiry.peStrikes ?? []).map((row) => ({\n            ...row,\n            sourceProvider: \"KITE\",\n            receivedAt: storageReceivedAt,\n            sourceVersion: row.contractRegime === \"LIVE_CONTRACT_MASTER\"\n              ? \"KITE_LIVE_CONTRACT_MASTER|SNAPSHOT_RECEIPT_PROXY\"\n              : \"KITE_OPTION_SNAPSHOT_RECEIPT_PROXY\",\n          })),\n        })),\n      };\n\n      void persistStorageV3FromExistingSnapshot(storageSym, storageMarketForTruth, {\n        oiPcr: storageMarket.pcr,\n        volumePcr: storageMarket.volumePcr,\n        fullChainPcr: storageMarket.gapScore?.fullChainPcr ?? null,\n        maxPain: storageMarket.maxPain,\n        sourceProvider: \"KITE\",\n        receivedAt: storageReceivedAt,\n        sourceVersion: \"KITE_CHAIN_DERIVED|SNAPSHOT_RECEIPT_PROXY\",\n        sourceTimestamp: null,\n      }).then((result) => {\n        if (!result.ok && !result.skipped) console.warn(\"[Storage V3] write returned not-ok\", storageSym, result.reason ?? \"UNKNOWN\");\n      }).catch((err) => {\n        console.error(\"[Storage V3] persistence call failed without affecting live cycle:\", err instanceof Error ? err.message : err);\n      });\n    }\n    // STORAGE_V3_RUNTIME_WIRE_END`;

  source = source.replace(SNAPSHOT_ANCHOR, wiring);
}

const appPatterns = [/const app = new Hono\(\);/, /const app = new Hono<[^;]+>\(\);/];

function mountAfterApp(marker, line, warning) {
  if (source.includes(marker)) return;
  for (const pattern of appPatterns) {
    const match = source.match(pattern);
    if (!match) continue;
    const original = match[0];
    source = source.replace(original, `${original}\n${marker}\n${line}`);
    return;
  }
  console.warn(warning);
}

mountAfterApp(HEALTH_MOUNT_MARKER, "mountStorageHealthRoutes(app);", "[Storage V3 wire] Hono app anchor not found; health route not mounted");
mountAfterApp(TEF_MOUNT_MARKER, "mountTefInspectRoutes(app);", "[Storage V3 wire] Hono app anchor not found; TEF inspection routes not mounted");
mountAfterApp(TELEGRAM_PREVIEW_MOUNT_MARKER, "mountTelegramPreviewRoutes(app);", "[Storage V3 wire] Hono app anchor not found; Telegram preview route not mounted");

writeFileSync(path, source, "utf8");
console.log("[Storage V3 wire] runtime storage wiring ready");

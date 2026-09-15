import { readFileSync, writeFileSync } from "node:fs";

const CHECK_ONLY = process.argv.includes("--check");
const path = new URL("../server.ts", import.meta.url);
const dbPath = new URL("../db.ts", import.meta.url);
const storageAdapterPath = new URL("../storage-v3-adapter.ts", import.meta.url);
const replayPath = new URL("../h1-replay-http.ts", import.meta.url);

let source = readFileSync(path, "utf8");
let dbSource = readFileSync(dbPath, "utf8");
let storageAdapterSource = readFileSync(storageAdapterPath, "utf8");
let replaySource = readFileSync(replayPath, "utf8");

function replaceRequired(text, before, after, label) {
  if (text.includes(after)) return text;
  if (!text.includes(before)) throw new Error(`[Storage V3 depth] ${label} anchor not found`);
  return text.replace(before, after);
}

// Forward-only depth evidence contract. Historical rows stay NULL; no synthetic backfill.
// Semantics intentionally match the production capital/liquidity adapter exactly:
// bidQty = best bid level quantity, askQty = best ask level quantity.
const producerPricePair = `              bid: oq.depth?.buy?.[0]?.price || 0,\n              ask: oq.depth?.sell?.[0]?.price || 0,`;
const producerDepthPair = `              bid: oq.depth?.buy?.[0]?.price || 0,\n              ask: oq.depth?.sell?.[0]?.price || 0,\n              bidQty: oq.depth?.buy?.[0]?.quantity ?? null,\n              askQty: oq.depth?.sell?.[0]?.quantity ?? null,`;
if (!source.includes("bidQty: oq.depth?.buy?.[0]?.quantity ?? null")) {
  const producerMatches = source.split(producerPricePair).length - 1;
  if (producerMatches < 1) throw new Error("[Storage V3 depth] live option top-of-book producer anchor not found");
  source = source.replaceAll(producerPricePair, producerDepthPair);
}

storageAdapterSource = replaceRequired(
  storageAdapterSource,
  `  bid?: Numeric;\n  ask?: Numeric;\n  lastPrice?: Numeric;`,
  `  bid?: Numeric;\n  ask?: Numeric;\n  bidQty?: Numeric;\n  askQty?: Numeric;\n  lastPrice?: Numeric;`,
  "storage adapter premium depth type",
);
storageAdapterSource = replaceRequired(
  storageAdapterSource,
  `    bid,\n    ask,\n    spread: bid !== null && ask !== null ? Math.max(0, ask - bid) : null,`,
  `    bid,\n    ask,\n    bidQty: finite(args.row.bidQty),\n    askQty: finite(args.row.askQty),\n    spread: bid !== null && ask !== null ? Math.max(0, ask - bid) : null,`,
  "storage adapter option row depth mapping",
);

dbSource = replaceRequired(
  dbSource,
  `  bid?: number | null;\n  ask?: number | null;\n  spread?: number | null;`,
  `  bid?: number | null;\n  ask?: number | null;\n  bidQty?: number | null;\n  askQty?: number | null;\n  spread?: number | null;`,
  "DB option row depth type",
);
dbSource = replaceRequired(
  dbSource,
  `        bid DOUBLE PRECISION,\n        ask DOUBLE PRECISION,\n        spread DOUBLE PRECISION,`,
  `        bid DOUBLE PRECISION,\n        ask DOUBLE PRECISION,\n        bid_qty BIGINT,\n        ask_qty BIGINT,\n        spread DOUBLE PRECISION,`,
  "DB option table depth columns",
);
dbSource = replaceRequired(
  dbSource,
  `        ADD COLUMN IF NOT EXISTS derived_oi_change_gap_seconds INTEGER;`,
  `        ADD COLUMN IF NOT EXISTS derived_oi_change_gap_seconds INTEGER;\n      ALTER TABLE option_snapshot_1m\n        ADD COLUMN IF NOT EXISTS bid_qty BIGINT,\n        ADD COLUMN IF NOT EXISTS ask_qty BIGINT;`,
  "DB backward-compatible depth migration",
);
dbSource = replaceRequired(
  dbSource,
  `        quote_timestamp, quote_age_seconds, liquidity_status, validation_status, calculation_version\n      )`,
  `        quote_timestamp, quote_age_seconds, liquidity_status, validation_status, calculation_version, bid_qty, ask_qty\n      )`,
  "DB option insert depth columns",
);
dbSource = replaceRequired(
  dbSource,
  `        $19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34\n      FROM derived`,
  `        $19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36\n      FROM derived`,
  "DB option insert depth parameters",
);
dbSource = replaceRequired(
  dbSource,
  `        calculation_version=EXCLUDED.calculation_version\n    \`, [`,
  `        calculation_version=EXCLUDED.calculation_version,\n        bid_qty=EXCLUDED.bid_qty, ask_qty=EXCLUDED.ask_qty\n    \`, [`,
  "DB option conflict depth update",
);
dbSource = replaceRequired(
  dbSource,
  `      row.pdh ?? null,row.pdl ?? null,row.quoteTimestamp ?? null,row.quoteAgeSeconds ?? null,row.liquidityStatus ?? null,row.validationStatus ?? null,row.calculationVersion ?? null,\n    ]);`,
  `      row.pdh ?? null,row.pdl ?? null,row.quoteTimestamp ?? null,row.quoteAgeSeconds ?? null,row.liquidityStatus ?? null,row.validationStatus ?? null,row.calculationVersion ?? null,\n      row.bidQty ?? null,row.askQty ?? null,\n    ]);`,
  "DB option depth values",
);

replaySource = replaceRequired(
  replaySource,
  `          o.ltp, o.bid, o.ask, o.spread, o.volume, o.oi, o.oi_change,`,
  `          o.ltp, o.bid, o.ask, o.bid_qty, o.ask_qty, o.spread, o.volume, o.oi, o.oi_change,`,
  "H1 replay depth projection",
);

const IMPORT_MARKER = 'import { persistStorageV3FromExistingSnapshot } from "./storage-v3-adapter.js";';
const HEALTH_IMPORT = 'import { mountStorageHealthRoutes } from "./storage-health.js";';
const TEF_INSPECT_IMPORT = 'import { mountTefInspectRoutes } from "./tef-inspect.js";';
const TELEGRAM_PREVIEW_IMPORT = 'import { mountTelegramPreviewRoutes } from "./telegram-preview-route.js";';
const DHAN_AUDIT_IMPORT = 'import { mountDhanAuditStatusRoute } from "./dhan-audit-status-route.js";';
const OPTION_RECORDER_EXPORT_IMPORT = 'import { mountOptionRecorderExportRoute } from "./option-recorder-export-route.js";';
const DB_IMPORT = 'import { dbInit, dbInsert, dbLoadRecent, dbIsConfigured } from "./db.js";';
const SNAPSHOT_ANCHOR = `    session.marketSnapshot = snapshot;\n    session.snapshotTime = Date.now();`;
const WIRE_MARKER = "// STORAGE_V3_RUNTIME_WIRE_BEGIN";
const HEALTH_MOUNT_MARKER = "// STORAGE_V3_HEALTH_ROUTE_MOUNT";
const TEF_MOUNT_MARKER = "// TEF_INSPECT_ROUTE_MOUNT";
const TELEGRAM_PREVIEW_MOUNT_MARKER = "// TELEGRAM_PREVIEW_ROUTE_MOUNT";
const DHAN_AUDIT_MOUNT_MARKER = "// DHAN_AUDIT_STATUS_ROUTE_MOUNT";
const OPTION_RECORDER_EXPORT_MOUNT_MARKER = "// OPTION_RECORDER_EXPORT_ROUTE_MOUNT";

if (!source.includes(IMPORT_MARKER)) {
  if (!source.includes(DB_IMPORT)) throw new Error("[Storage V3 wire] db import anchor not found");
  source = source.replace(DB_IMPORT, `${DB_IMPORT}\n${IMPORT_MARKER}`);
}

if (!source.includes(HEALTH_IMPORT)) source = source.replace(IMPORT_MARKER, `${IMPORT_MARKER}\n${HEALTH_IMPORT}`);
if (!source.includes(TEF_INSPECT_IMPORT)) source = source.replace(HEALTH_IMPORT, `${HEALTH_IMPORT}\n${TEF_INSPECT_IMPORT}`);
if (!source.includes(TELEGRAM_PREVIEW_IMPORT)) source = source.replace(TEF_INSPECT_IMPORT, `${TEF_INSPECT_IMPORT}\n${TELEGRAM_PREVIEW_IMPORT}`);
if (!source.includes(DHAN_AUDIT_IMPORT)) source = source.replace(TELEGRAM_PREVIEW_IMPORT, `${TELEGRAM_PREVIEW_IMPORT}\n${DHAN_AUDIT_IMPORT}`);
if (!source.includes(OPTION_RECORDER_EXPORT_IMPORT)) source = source.replace(DHAN_AUDIT_IMPORT, `${DHAN_AUDIT_IMPORT}\n${OPTION_RECORDER_EXPORT_IMPORT}`);

if (!source.includes(WIRE_MARKER)) {
  const matches = source.split(SNAPSHOT_ANCHOR).length - 1;
  if (matches !== 1) throw new Error(`[Storage V3 wire] expected exactly one snapshot anchor, found ${matches}`);

  const wiring = `${SNAPSHOT_ANCHOR}\n\n    ${WIRE_MARKER}\n    // Storage-only persistence of data already fetched/calculated by this refresh.\n    // No extra Kite request, no scoring/verdict/Telegram/execution side effect.\n    for (const storageSym of [\"NIFTY\", \"BANKNIFTY\", \"SENSEX\"] as const) {\n      const storageMarket = snapshot[storageSym];\n      if (!storageMarket || storageMarket.error) continue;\n      void persistStorageV3FromExistingSnapshot(storageSym, storageMarket, {\n        oiPcr: storageMarket.pcr,\n        volumePcr: storageMarket.volumePcr,\n        fullChainPcr: storageMarket.gapScore?.fullChainPcr ?? null,\n        maxPain: storageMarket.maxPain,\n      }).then((result) => {\n        if (!result.ok && !result.skipped) {\n          console.warn(\"[Storage V3] write returned not-ok\", storageSym, result.reason ?? \"UNKNOWN\");\n        }\n      }).catch((err) => {\n        console.error(\"[Storage V3] persistence call failed without affecting live cycle:\", err instanceof Error ? err.message : err);\n      });\n    }\n    // STORAGE_V3_RUNTIME_WIRE_END`;

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

source = source.replace(
  /mountDhanAuditStatusRoute\(app,\s*getValidDhanAccessToken\);/g,
  "mountDhanAuditStatusRoute(app, getValidDhanAccessToken, refreshDhanAccessToken);",
);

mountAfterApp(DHAN_AUDIT_MOUNT_MARKER, "mountDhanAuditStatusRoute(app, getValidDhanAccessToken, refreshDhanAccessToken);", "[Storage V3 wire] Hono app anchor not found; Dhan audit status route not mounted");
mountAfterApp(
  OPTION_RECORDER_EXPORT_MOUNT_MARKER,
  "mountOptionRecorderExportRoute(app, () => { let activeSession; for (const s of sessions.values()) { if (s.expiresAt > Date.now() && s.marketSnapshot) { activeSession = s; break; } } return { marketSnapshot: activeSession?.marketSnapshot, recorderSnapshots: recorderSession.snapshots }; });",
  "[Storage V3 wire] Hono app anchor not found; Option Recorder export route not mounted",
);

if (CHECK_ONLY) {
  console.log("[Storage V3 wire] CHECK PASS — exact top-of-book depth archival/replay wiring applicable");
} else {
  writeFileSync(dbPath, dbSource, "utf8");
  writeFileSync(storageAdapterPath, storageAdapterSource, "utf8");
  writeFileSync(replayPath, replaySource, "utf8");
  writeFileSync(path, source, "utf8");
  console.log("[Storage V3 wire] runtime storage wiring ready; exact top-of-book depth archive enabled forward-only");
}

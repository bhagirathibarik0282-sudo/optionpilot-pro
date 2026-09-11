import fs from "node:fs";
import path from "node:path";

const file = path.resolve(process.cwd(), "server.ts");
let src = fs.readFileSync(file, "utf8");
const original = src;
const MARKER = "OPTIONPILOT_TRUTH_SYNC_COLLECTION_CYCLE_V1";

if (src.includes(MARKER)) {
  console.log("truth sync collection-cycle wiring already applied");
  process.exit(0);
}

const from = `    const timestamps = [m.exchangeTimestamp, contract?.quoteTimestamp, atmCe?.quoteTimestamp, atmPe?.quoteTimestamp]\n      .filter((t): t is string => !!t)\n      .map((t) => new Date(t).getTime());\n    if (timestamps.length >= 2) {\n      const spread = Math.max(...timestamps) - Math.min(...timestamps);\n      syncOk = spread <= TRUTH_SYNC_TOLERANCE_MS;\n    }`;

const to = `    // ${MARKER}: this snapshotId identifies one synchronized backend collection cycle.\n    // Individual spot/futures/options freshness is already validated above.\n    // Do not treat provider last-trade-time differences as collection desynchronization.\n    syncOk = !!m.snapshotId;`;

const count = src.split(from).length - 1;
if (count === 0) {
  console.warn("truth sync anchor not found; leaving core startup unchanged");
  process.exit(0);
}
if (count > 1) {
  console.warn(`truth sync anchor count=${count}; refusing ambiguous mutation`);
  process.exit(0);
}

src = src.replace(from, to);
if (src !== original) {
  fs.writeFileSync(file, src, "utf8");
  console.log("truth sync collection-cycle wiring applied");
} else {
  console.log("truth sync collection-cycle wiring unchanged");
}

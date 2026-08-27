import fs from "node:fs";

const path = "server.ts";
let src = fs.readFileSync(path, "utf8");
const start = src.indexOf('app.get("/api/offline-research/nifty-deterministic-replay"');
const end = src.indexOf('app.get("/api/research/shadow-diagnostic-trace"', start);
if (start < 0 || end < 0) throw new Error("Phase66 replay route not found");
let block = src.slice(start, end);

const oldState = 'const dayState = new Map<string, { seen: number; first15High: number | null; first15Low: number | null }>();';
const newState = 'const dayState = new Map<string, { minutes: Set<number>; first15High: number | null; first15Low: number | null }>();';
if (!block.includes(oldState)) throw new Error("hardened dayState anchor missing");
block = block.replace(oldState, newState);

const oldLogic = `      const dayKey = bucketIso.slice(0, 10);\n      const ds = dayState.get(dayKey) || { seen: 0, first15High: null, first15Low: null };\n      if (ds.seen < 15) {\n        if (Number.isFinite(dayHigh)) ds.first15High = ds.first15High == null ? dayHigh : Math.max(ds.first15High, dayHigh);\n        if (Number.isFinite(dayLow)) ds.first15Low = ds.first15Low == null ? dayLow : Math.min(ds.first15Low, dayLow);\n        ds.seen++;\n      }\n      dayState.set(dayKey, ds);\n      const first15High = ds.first15High == null ? Number.NaN : ds.first15High;\n      const first15Low = ds.first15Low == null ? Number.NaN : ds.first15Low;`;

const newLogic = `      const istMs = marketBucketMs + 330 * 60 * 1000;\n      const istDate = new Date(istMs);\n      const dayKey = istDate.toISOString().slice(0, 10);\n      const istMinuteOfDay = istDate.getUTCHours() * 60 + istDate.getUTCMinutes();\n      const ds = dayState.get(dayKey) || { minutes: new Set<number>(), first15High: null, first15Low: null };\n      // Exact NSE opening window 09:15-09:29 IST; never extend because an aligned minute is missing.\n      if (istMinuteOfDay >= 555 && istMinuteOfDay <= 569 && !ds.minutes.has(istMinuteOfDay)) {\n        ds.minutes.add(istMinuteOfDay);\n        if (Number.isFinite(dayHigh)) ds.first15High = ds.first15High == null ? dayHigh : Math.max(ds.first15High, dayHigh);\n        if (Number.isFinite(dayLow)) ds.first15Low = ds.first15Low == null ? dayLow : Math.min(ds.first15Low, dayLow);\n      }\n      dayState.set(dayKey, ds);\n      const first15Complete = ds.minutes.size === 15 && istMinuteOfDay >= 569;\n      const first15High = first15Complete && ds.first15High != null ? ds.first15High : Number.NaN;\n      const first15Low = first15Complete && ds.first15Low != null ? ds.first15Low : Number.NaN;\n      // PHASE68_FIRST15_IST_WINDOW_V1`;

if (!block.includes(oldLogic)) throw new Error("hardened first15 row-count logic anchor missing");
block = block.replace(oldLogic, newLogic);

if (block.includes("ds.seen < 15")) throw new Error("row-count first15 logic still present");
if (!block.includes("istMinuteOfDay >= 555 && istMinuteOfDay <= 569")) throw new Error("IST opening window guard missing");
if (!block.includes("ds.minutes.size === 15")) throw new Error("15 distinct opening minutes completeness check missing");
if (!block.includes("PHASE68_FIRST15_IST_WINDOW_V1")) throw new Error("Phase68 marker missing");
if (!block.includes("Number.NaN")) throw new Error("fail-closed NaN missing");

src = src.slice(0, start) + block + src.slice(end);
fs.writeFileSync(path, src);
console.log("Phase68 first15 IST window fix applied");

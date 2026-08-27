import fs from "node:fs";

const path = "server.ts";
let src = fs.readFileSync(path, "utf8");
const start = src.indexOf('app.get("/api/offline-research/nifty-deterministic-replay"');
const end = src.indexOf('app.get("/api/research/shadow-diagnostic-trace"', start);
if (start < 0 || end < 0) throw new Error("Phase66 replay route not found");
let block = src.slice(start, end);

const oldState = 'const first15ByDay = new Map<string, { seen: number; high: number; low: number }>();';
const newState = 'const first15ByDay = new Map<string, { minutes: Set<number>; high: number; low: number }>();';
if (!block.includes(oldState)) throw new Error("old first15 state anchor missing");
block = block.replace(oldState, newState);

const oldLogic = `    const dayKey = bucketIso.slice(0, 10);\n    const ds = first15ByDay.get(dayKey) || { seen: 0, high: Number.NEGATIVE_INFINITY, low: Number.POSITIVE_INFINITY };\n    if (ds.seen < 15) {\n      if (Number.isFinite(dayHigh)) ds.high = Math.max(ds.high, dayHigh);\n      if (Number.isFinite(dayLow)) ds.low = Math.min(ds.low, dayLow);\n      ds.seen++;\n      first15ByDay.set(dayKey, ds);\n    }\n    const first15High = ds.seen >= 15 && Number.isFinite(ds.high) ? ds.high : Number.NaN;\n    const first15Low = ds.seen >= 15 && Number.isFinite(ds.low) ? ds.low : Number.NaN;`;

const newLogic = `    const istMs = marketBucketMs + 330 * 60 * 1000;\n    const istDate = new Date(istMs);\n    const dayKey = istDate.toISOString().slice(0, 10);\n    const istMinuteOfDay = istDate.getUTCHours() * 60 + istDate.getUTCMinutes();\n    const ds = first15ByDay.get(dayKey) || { minutes: new Set<number>(), high: Number.NEGATIVE_INFINITY, low: Number.POSITIVE_INFINITY };\n    // Exact NSE opening 15-minute window: 09:15-09:29 IST. No row-count extension past 09:29.\n    if (istMinuteOfDay >= 555 && istMinuteOfDay <= 569) {\n      if (!ds.minutes.has(istMinuteOfDay)) {\n        ds.minutes.add(istMinuteOfDay);\n        if (Number.isFinite(dayHigh)) ds.high = Math.max(ds.high, dayHigh);\n        if (Number.isFinite(dayLow)) ds.low = Math.min(ds.low, dayLow);\n      }\n      first15ByDay.set(dayKey, ds);\n    }\n    const first15Complete = ds.minutes.size === 15 && istMinuteOfDay >= 569;\n    const first15High = first15Complete && Number.isFinite(ds.high) ? ds.high : Number.NaN;\n    const first15Low = first15Complete && Number.isFinite(ds.low) ? ds.low : Number.NaN;\n    // PHASE68_FIRST15_IST_WINDOW_V1`;

if (!block.includes(oldLogic)) throw new Error("old first15 row-count logic anchor missing");
block = block.replace(oldLogic, newLogic);

if (block.includes("ds.seen < 15")) throw new Error("row-count first15 logic still present");
if (!block.includes("istMinuteOfDay >= 555 && istMinuteOfDay <= 569")) throw new Error("IST opening window guard missing");
if (!block.includes("ds.minutes.size === 15")) throw new Error("15 distinct opening minutes completeness check missing");
if (!block.includes("Number.NaN")) throw new Error("fail-closed NaN missing");

src = src.slice(0, start) + block + src.slice(end);
fs.writeFileSync(path, src);
console.log("Phase68 first15 IST window fix applied");

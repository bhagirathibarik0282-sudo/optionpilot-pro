import fs from "node:fs";

const src = fs.readFileSync("server.ts", "utf8");
const routeStart = src.indexOf('app.get("/api/offline-research/nifty-deterministic-replay"');
const routeEnd = src.indexOf('app.get("/api/research/shadow-diagnostic-trace"', routeStart);
if (routeStart < 0 || routeEnd < 0) throw new Error("Phase66 replay route not found");
const route = src.slice(routeStart, routeEnd);

const functionBlock = (name) => {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) return "";
  const next = src.indexOf("\nfunction ", start + 10);
  return src.slice(start, next > start ? next : Math.min(src.length, start + 50000));
};
const validator = functionBlock("validateDataServer");
const core = functionBlock("runRuleEngineServerCore");
const pcrHelper = functionBlock("serverComputePcrTrendValue");

const fields = ["signal","futuresVwapBias","first15High","first15Low","vixChangePercent","atmStrike","volumePcr","future_vwap","pcr"];
const count = (text, needle) => text.split(needle).length - 1;
const usage = Object.fromEntries(fields.map((f) => [f, {
  replay: count(route, f),
  validator: count(validator, f),
  core: count(core, f),
  pcrHelper: count(pcrHelper, f),
}]));

const checks = {
  researchOnly: route.includes("researchOnly: true"),
  noPersistence: route.includes("scorePersistence: false") && !route.includes("persistKnownThenScoreObservation("),
  noBroker: route.includes("brokerCalls: false") && !route.includes("getQuote(") && !route.includes("kite."),
  noTelegram: route.includes("telegramCalls: false") && !route.includes("sendTelegram"),
  chronologicalMarketOrder: route.includes("ORDER BY minute_bucket ASC"),
  replayClockInjected: route.includes("validateDataServer(symbol, m, replaySession, null, marketBucketMs)"),
  exactCoreReused: route.includes("runRuleEngineServerCore(symbol, m, validation, null)"),
  pcrHistoryAppendBeforeValidation: route.indexOf("replaySession.snapshotHistory!.push") >= 0 && route.indexOf("replaySession.snapshotHistory!.push") < route.indexOf("validateDataServer(symbol, m, replaySession, null, marketBucketMs)"),
  pcrHistoryBounded: route.includes("length > 5000"),
  currentChainUsesCurrentBucket: route.includes("const chains = chainByMinute.get(bucketIso) || []"),
  canonicalPcr: route.includes("full_chain_oi_pcr"),
  canonicalVolumePcr: route.includes("volume_pcr"),
  recordedAtm: route.includes("atm_strike"),
  recordedFutureVwap: route.includes("future_vwap"),
  missingMetricsFailClosedNaN: route.includes("Number.NaN"),
  noFakeAtmZero: !route.includes("atmStrike: 0"),
  noFakeVixChangePercentZero: !route.includes("vixChangePercent: 0"),
  noFakeFirst15Zero: !route.includes("first15High: 0") && !route.includes("first15Low: 0"),
};

const risks = [];
if (route.includes("ds.seen < 15")) risks.push({severity:"P1", code:"FIRST15_ROW_COUNT_ASSUMPTION", detail:"First-15 is reconstructed from first 15 aligned rows, not an explicit 09:15–09:29 IST clock window. Missing aligned minutes could extend the window."});
if (route.includes('signal: "WAIT"') && (usage.signal.validator > 0 || usage.signal.core > 0)) risks.push({severity:"P0", code:"FABRICATED_SIGNAL_CONSUMED", detail:"Replay injects signal=WAIT and validator/core references signal. Must prove this field is non-scoring or remove fabrication."});
if (route.includes('futuresVwapBias:') && usage.futuresVwapBias.core > 0) risks.push({severity:"P1", code:"DERIVED_FUTURES_VWAP_BIAS_CONSUMED", detail:"Replay derives futuresVwapBias from recorded LTP/VWAP; verify exact production derivation semantics before parity claim."});
if (route.includes("vixChangePercent: Number.NaN") && (usage.vixChangePercent.validator > 0 || usage.vixChangePercent.core > 0)) risks.push({severity:"P1", code:"VIX_CHANGE_PERCENT_UNAVAILABLE", detail:"Replay intentionally leaves vixChangePercent unavailable; validator/core references it, so buckets may fail closed."});
if (!pcrHelper) risks.push({severity:"P1", code:"PCR_HELPER_NOT_EXTRACTED", detail:"Could not statically extract serverComputePcrTrendValue; parity for PCR trend requires explicit helper verification."});

const p0 = risks.filter((r) => r.severity === "P0");
const report = {
  version:"PHASE67_SEMANTIC_PARITY_AUDIT_V1",
  architectureRole:"STATIC_REPLAY_SEMANTIC_AUDIT",
  productionImpact:"NONE",
  mutationAllowed:false,
  checks,
  usage,
  risks,
  gate: p0.length ? "STOP_P0" : "PROCEED_WITH_P1_ISOLATION",
};
fs.mkdirSync("docs", {recursive:true});
fs.writeFileSync("docs/phase67-semantic-parity-audit.json", JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
if (Object.values(checks).some((v) => v !== true)) process.exitCode = 2;

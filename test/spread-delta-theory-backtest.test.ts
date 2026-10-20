import test from "node:test";
import assert from "node:assert/strict";
import { parseDeltaTarget, selectRecordedDeltaAnchor } from "../spread-delta-theory-backtest.js";

const symbol = "NIFTY", expiry = "2026-10-19", day = "2026-10-19";
function raw(
  hm: string, side: "CE"|"PE", strike: number, delta: number,
  opts: { snapshotId?: string; marketSnapshotId?: string; truth?: string;
    validation?: string; age?: number; quoteSecond?: number; quoteSkewMs?: number } = {},
) {
  const minute = Date.parse(day + "T" + hm + ":00+05:30");
  return {
    symbol, expiry, dte: 0, strike, option_type: side,
    minute_bucket: new Date(minute).toISOString(),
    snapshot_id: opts.snapshotId ?? "snap-"+hm,
    market_snapshot_id: opts.marketSnapshotId ?? "snap-"+hm,
    truth_verdict: opts.truth ?? "TRUE", validation_status: opts.validation ?? "RESEARCH_ELIGIBLE",
    ltp: side === "CE" ? 150 : 147,
    delta, quote_timestamp: new Date(minute + (opts.quoteSecond ?? 8)*1000 + (opts.quoteSkewMs ?? 0)).toISOString(),
    quote_age_seconds: opts.age ?? 3,
  };
}
test("defaults to 0.50 and allows existing dashboard absolute Delta targets only", () => {
  assert.equal(parseDeltaTarget(undefined), 0.5);
  assert.equal(parseDeltaTarget("0.25"), 0.25);
  assert.equal(parseDeltaTarget("0.40"), 0.4);
  assert.equal(parseDeltaTarget("0.50"), 0.5);
  for (const x of ["0.0", "0.60", "foo", "-0.25", "1"]) assert.equal(parseDeltaTarget(x), null);
});
test("chooses SAME-expiry opposite-sign same-absolute-Delta pair, not same strike", () => {
  const rows = [
    raw("09:36", "CE", 23100, 0.405),
    raw("09:36", "PE", 22900, -0.412),
    raw("09:36", "CE", 23000, 0.5),
    raw("09:36", "PE", 23000, -0.52),
  ];
  const p = selectRecordedDeltaAnchor(rows, symbol, expiry, 0.4);
  assert.ok(p);
  assert.equal(p.ceStrike, 23100);
  assert.equal(p.peStrike, 22900);
  assert.equal(p.ceDelta, 0.405);
  assert.equal(p.peDelta, -0.412);
  assert.equal(Number((p.ceDelta-p.peDelta).toFixed(3)), 0.817);
});
test("earliest observed qualified bucket wins over later better Delta match", () => {
  const rows = [
    raw("09:36", "CE", 23050, .48), raw("09:36", "PE", 22950, -.485),
    raw("09:39", "CE", 23000, .5), raw("09:39", "PE", 23000, -.5),
  ];
  const p = selectRecordedDeltaAnchor(rows, symbol, expiry, .5);
  assert.ok(p);
  assert.equal(p.anchorBucket, new Date(day+"T09:36:00+05:30").toISOString());
  assert.equal(p.ceStrike, 23050);
  assert.equal(p.peStrike, 22950);
});
test("rejects mismatched snapshots, invalid age, wrong signs, and diagnostics", () => {
  assert.equal(selectRecordedDeltaAnchor([raw("09:36","CE",23050,.5),raw("09:36","PE",22950,-.5,{snapshotId:"other"})],symbol,expiry,.5), null);
  assert.equal(selectRecordedDeltaAnchor([raw("09:36","CE",23050,.5),raw("09:36","PE",22950,-.5,{age:31})],symbol,expiry,.5),null);
  assert.equal(selectRecordedDeltaAnchor([raw("09:36","CE",23050,.5),raw("09:36","PE",22950,.5)],symbol,expiry,.5),null);
  assert.equal(selectRecordedDeltaAnchor([raw("09:36","CE",23050,.5),raw("09:36","PE",22950,-.5,{validation:"TIMESTAMP_PRESENT"})],symbol,expiry,.5),null);
  assert.equal(selectRecordedDeltaAnchor([raw("09:36","CE",23050,.5),raw("09:36","PE",22950,-.5,{truth:"FALSE"})],symbol,expiry,.5),null);
});
test("withholds misaligned quote source times and duplicates instead of inventing pair", () => {
  const ce = raw("09:36","CE",23050,.5);
  assert.equal(selectRecordedDeltaAnchor([ce,raw("09:36","PE",22950,-.5,{quoteSkewMs:1000})],symbol,expiry,.5),null);
  assert.equal(selectRecordedDeltaAnchor([ce,ce,raw("09:36","PE",22950,-.5)],symbol,expiry,.5),null);
  assert.equal(selectRecordedDeltaAnchor([ce,raw("09:36","PE",22950,-.5,{quoteSecond:60})],symbol,expiry,.5),null);
  assert.equal(selectRecordedDeltaAnchor([raw("09:36","CE",23050,.5,{quoteSecond:80}),raw("09:36","PE",22950,-.5,{quoteSecond:80})],symbol,expiry,.5),null);
});
test("wrong expiry stays withheld and missing one side never becomes a pair", () => {
  const a = raw("09:36","CE",23050,.5);
  const b = { ...raw("09:36","PE",22950,-.5), expiry: "2026-10-27" };
  assert.equal(selectRecordedDeltaAnchor([a,b],symbol,expiry,.5),null);
  assert.equal(selectRecordedDeltaAnchor([a],symbol,expiry,.5),null);
});

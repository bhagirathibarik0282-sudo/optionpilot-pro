import test from "node:test";
import assert from "node:assert/strict";
import {
  runFiiDiiCashCatchupCore,
  shouldAttemptFiiDiiCashCatchup,
} from "../fii-dii-cash-catchup-runtime.js";
import type { NormalizedFiiDiiCash } from "../fii-dii-nse.js";

const officialRows = [
  { date: "2026-09-18", category: "FII_FPI" as const, buyCrore: 10, sellCrore: 12, netCrore: -2 },
  { date: "2026-09-18", category: "DII" as const, buyCrore: 14, sellCrore: 9, netCrore: 5 },
];

test("catch-up does not fetch when DB already has latest recorded market session", async () => {
  let fetched = 0;
  const out = await runFiiDiiCashCatchupCore(
    {
      nowIso: "2026-09-19T04:30:00.000Z",
      expectedMarketSessionDate: "2026-09-18",
      latestStoredSessionDate: "2026-09-18",
    },
    {
      fetchOfficial: async () => {
        fetched += 1;
        throw new Error("SHOULD_NOT_FETCH");
      },
      persistAndVerify: async () => {
        throw new Error("SHOULD_NOT_WRITE");
      },
    },
  );
  assert.equal(out.status, "UP_TO_DATE");
  assert.equal(out.ok, true);
  assert.equal(fetched, 0);
  assert.equal(out.affectsCandidate, false);
  assert.equal(out.affectsTelegram, false);
  assert.equal(out.affectsExecution, false);
});

test("same-session catch-up waits until existing 19:00 IST cron window", () => {
  assert.equal(shouldAttemptFiiDiiCashCatchup({
    nowIso: "2026-09-18T12:59:00.000Z",
    expectedMarketSessionDate: "2026-09-18",
    latestStoredSessionDate: "2026-09-17",
  }), false);
  assert.equal(shouldAttemptFiiDiiCashCatchup({
    nowIso: "2026-09-18T13:30:00.000Z",
    expectedMarketSessionDate: "2026-09-18",
    latestStoredSessionDate: "2026-09-17",
  }), true);
});

test("past-session stale DB is eligible immediately, including weekend startup", () => {
  assert.equal(shouldAttemptFiiDiiCashCatchup({
    nowIso: "2026-09-19T04:30:00.000Z",
    expectedMarketSessionDate: "2026-09-18",
    latestStoredSessionDate: "2026-09-16",
  }), true);
});

test("official exact expected session is persisted once and remains context-only", async () => {
  const writes: NormalizedFiiDiiCash[] = [];
  const out = await runFiiDiiCashCatchupCore(
    {
      nowIso: "2026-09-19T04:30:00.000Z",
      expectedMarketSessionDate: "2026-09-18",
      latestStoredSessionDate: "2026-09-16",
    },
    {
      fetchOfficial: async () => ({
        ok: true,
        rows: officialRows,
        attempts: 1,
        sourceUrl: "https://www.nseindia.com/api/fiidiiTradeNse",
        blocker: null,
      }),
      persistAndVerify: async (row) => {
        writes.push(row);
      },
    },
  );
  assert.equal(out.status, "REPAIRED");
  assert.equal(out.ok, true);
  assert.equal(out.expectedMarketSessionDate, "2026-09-18");
  assert.equal(out.latestStoredSessionDate, "2026-09-18");
  assert.equal(out.dbReadbackVerified, true);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].date, "2026-09-18");
  assert.equal(out.grantsDirectionalSupport, false);
  assert.equal(out.affectsVerdict, false);
  assert.equal(out.affectsCandidate, false);
  assert.equal(out.affectsTelegram, false);
  assert.equal(out.affectsExecution, false);
  assert.equal(out.createsOrders, false);
});

test("source date mismatch fails closed and never writes", async () => {
  let writes = 0;
  const out = await runFiiDiiCashCatchupCore(
    {
      nowIso: "2026-09-19T04:30:00.000Z",
      expectedMarketSessionDate: "2026-09-18",
      latestStoredSessionDate: "2026-09-16",
    },
    {
      fetchOfficial: async () => ({
        ok: true,
        rows: [
          { ...officialRows[0], date: "2026-09-17" },
          { ...officialRows[1], date: "2026-09-17" },
        ],
        attempts: 1,
        sourceUrl: "https://www.nseindia.com/api/fiidiiTradeNse",
        blocker: null,
      }),
      persistAndVerify: async () => {
        writes += 1;
      },
    },
  );
  assert.equal(out.status, "SOURCE_NOT_READY");
  assert.equal(out.ok, false);
  assert.match(out.blocker ?? "", /SOURCE_DATE_MISMATCH/);
  assert.equal(writes, 0);
});

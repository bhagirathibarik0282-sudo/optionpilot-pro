import test from "node:test";
import assert from "node:assert/strict";
import { evaluateImmediateExpansionChain } from "../immediate-expansion-chain.js";

test("CE is favoured only when locked trend and synchronized cluster support it", () => {
  const out = evaluateImmediateExpansionChain({
    symbol: "NIFTY",
    lockedTrendSide: "CE",
    trendValid: true,
    clusterReady: true,
    events: [
      { id: "1", family: "PCR", occurredAt: "2026-08-31T11:53:24+05:30", fact: "PCR jumped immediately.", abnormalImmediateChange: true, fresh: true, alignment: "FAVOURS_TREND" },
      { id: "2", family: "CALL_WALL", occurredAt: "2026-08-31T11:53:17+05:30", fact: "Call-wall OI shed immediately.", abnormalImmediateChange: true, fresh: true, alignment: "FAVOURS_TREND" },
      { id: "3", family: "CE_PREMIUM", occurredAt: "2026-08-31T11:53:27+05:30", fact: "CE premium expanded immediately.", abnormalImmediateChange: true, fresh: true, alignment: "FAVOURS_TREND" },
    ],
  });

  assert.equal(out.verdict, "CE_FAVOURED");
  assert.match(out.whyNow, /Call-wall OI shed immediately/);
  assert.equal(out.immediateEvents[0].family, "CALL_WALL");
  assert.equal(out.haikuMayChangeVerdict, false);
  assert.equal(out.affectsTelegram, false);
});

test("volatility-only IV/VIX expansion cannot create a directional verdict", () => {
  const out = evaluateImmediateExpansionChain({
    symbol: "NIFTY",
    lockedTrendSide: "CE",
    trendValid: true,
    clusterReady: false,
    events: [
      { id: "1", family: "ATM_IV", occurredAt: "2026-08-31T11:53:20+05:30", fact: "ATM IV expanded immediately.", abnormalImmediateChange: true, fresh: true, alignment: "VOLATILITY_ONLY" },
      { id: "2", family: "INDIA_VIX", occurredAt: "2026-08-31T11:53:22+05:30", fact: "India VIX accelerated.", abnormalImmediateChange: true, fresh: true, alignment: "VOLATILITY_ONLY" },
    ],
  });

  assert.equal(out.verdict, "WAIT");
  assert.match(out.whyNow, /volatility expansion/i);
});

test("conflicting immediate evidence stays WAIT until upstream cluster is ready", () => {
  const out = evaluateImmediateExpansionChain({
    symbol: "BANKNIFTY",
    lockedTrendSide: "CE",
    trendValid: true,
    clusterReady: false,
    events: [
      { id: "1", family: "PUT_WALL", occurredAt: "2026-08-31T11:53:20+05:30", fact: "Put support shed immediately.", abnormalImmediateChange: true, fresh: true, alignment: "CONFLICTS_TREND" },
      { id: "2", family: "CE_PREMIUM", occurredAt: "2026-08-31T11:53:21+05:30", fact: "CE premium expanded.", abnormalImmediateChange: true, fresh: true, alignment: "FAVOURS_TREND" },
    ],
  });

  assert.equal(out.verdict, "WAIT");
  assert.match(out.whyNow, /conflicting/i);
});

test("stale or non-abnormal events cannot enter the immediate cluster", () => {
  const out = evaluateImmediateExpansionChain({
    symbol: "NIFTY",
    lockedTrendSide: "PE",
    trendValid: true,
    clusterReady: true,
    events: [
      { id: "1", family: "PCR", occurredAt: "2026-08-31T11:53:20+05:30", fact: "PCR dropped.", abnormalImmediateChange: true, fresh: false, alignment: "FAVOURS_TREND" },
      { id: "2", family: "PE_PREMIUM", occurredAt: "2026-08-31T11:53:21+05:30", fact: "PE premium expanded slowly.", abnormalImmediateChange: false, fresh: true, alignment: "FAVOURS_TREND" },
    ],
  });

  assert.equal(out.verdict, "WAIT");
  assert.equal(out.immediateEvents.length, 0);
});

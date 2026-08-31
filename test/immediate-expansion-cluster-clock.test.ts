import test from "node:test";
import assert from "node:assert/strict";
import { ImmediateExpansionClusterClock } from "../immediate-expansion-cluster-clock.js";
import type { ImmediateVerifiedEvent } from "../immediate-expansion-chain.js";

function event(id: string, family: ImmediateVerifiedEvent["family"], second: number, alignment: ImmediateVerifiedEvent["alignment"]): ImmediateVerifiedEvent {
  return {
    id,
    family,
    occurredAt: new Date(Date.UTC(2026, 7, 31, 6, 0, second)).toISOString(),
    fact: `${family} changed`,
    abnormalImmediateChange: true,
    fresh: true,
    alignment,
  };
}

test("starts at exact T0 and accumulates relative event clock without waiting for window close", () => {
  const clock = new ImmediateExpansionClusterClock({ windowMs: 10_000, minSupportingFamilies: 2, minEvents: 2 });
  const first = clock.observe("NIFTY", event("a", "PCR", 0, "FAVOURS_TREND"));
  assert.equal(first.stage, "RAW");
  assert.equal(first.clusterReady, false);
  const second = clock.observe("NIFTY", event("b", "CE_PREMIUM", 2, "FAVOURS_TREND"));
  assert.equal(second.stage, "SYNCHRONIZED");
  assert.equal(second.clusterReady, true);
  assert.equal(second.events[0].relativeMs, 0);
  assert.equal(second.events[1].relativeMs, 2000);
});

test("fresh conflict fails closed even with enough supporting families", () => {
  const clock = new ImmediateExpansionClusterClock({ windowMs: 10_000, minSupportingFamilies: 2, minEvents: 2 });
  clock.observe("NIFTY", event("a", "PCR", 0, "FAVOURS_TREND"));
  clock.observe("NIFTY", event("b", "CE_PREMIUM", 1, "FAVOURS_TREND"));
  const result = clock.observe("NIFTY", event("c", "PUT_WALL", 2, "CONFLICTS_TREND"));
  assert.equal(result.conflictPresent, true);
  assert.equal(result.clusterReady, false);
  assert.equal(result.stage, "PERSISTING");
});

test("old events roll out relative to newest event", () => {
  const clock = new ImmediateExpansionClusterClock({ windowMs: 5_000, minSupportingFamilies: 2, minEvents: 2 });
  clock.observe("BANKNIFTY", event("a", "FUTURES", 0, "FAVOURS_TREND"));
  const result = clock.observe("BANKNIFTY", event("b", "CE_PREMIUM", 8, "FAVOURS_TREND"));
  assert.equal(result.t0, event("b", "CE_PREMIUM", 8, "FAVOURS_TREND").occurredAt);
  assert.equal(result.events.length, 1);
  assert.equal(result.clusterReady, false);
});

test("stale or non-abnormal event never enters cluster", () => {
  const clock = new ImmediateExpansionClusterClock({ windowMs: 10_000, minSupportingFamilies: 1, minEvents: 1 });
  const stale = { ...event("a", "PCR", 0, "FAVOURS_TREND"), fresh: false };
  const result = clock.observe("SENSEX", stale);
  assert.equal(result.events.length, 0);
  assert.equal(result.clusterReady, false);
});

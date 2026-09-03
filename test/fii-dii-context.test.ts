import test from "node:test";
import assert from "node:assert/strict";
import type { FiiDiiContextSnapshot } from "../fii-dii-context.js";

function assertContextAuthority(snapshot: FiiDiiContextSnapshot): void {
  assert.equal(snapshot.semantics, "CONTEXT_ONLY");
  assert.equal(snapshot.affectsVerdict, false);
  assert.equal(snapshot.affectsTelegram, false);
  assert.equal(snapshot.affectsExecution, false);
  assert.deepEqual(snapshot.windows.map((w) => w.sessions), [1, 3, 5, 20]);
}

test("FII/DII context cannot acquire verdict, Telegram, or execution authority", () => {
  const snapshot: FiiDiiContextSnapshot = {
    latestTradeDate: "2026-09-02",
    freshness: "PRIOR_SESSION",
    windows: ([1, 3, 5, 20] as const).map((sessions) => ({
      sessions,
      availableSessions: sessions,
      fiiNet: -100,
      diiNet: 80,
      combinedNet: -20,
      bias: "ABSORPTION",
    })),
    reasons: ["Institutional context only"],
    ruleVersion: "FII_DII_CONTEXT_V1",
    semantics: "CONTEXT_ONLY",
    affectsVerdict: false,
    affectsTelegram: false,
    affectsExecution: false,
  };

  assertContextAuthority(snapshot);
});

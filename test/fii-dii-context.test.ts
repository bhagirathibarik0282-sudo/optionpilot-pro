import { describe, expect, it } from "vitest";
import type { FiiDiiContextSnapshot } from "../fii-dii-context.js";

function assertContextAuthority(snapshot: FiiDiiContextSnapshot): void {
  expect(snapshot.semantics).toBe("CONTEXT_ONLY");
  expect(snapshot.affectsVerdict).toBe(false);
  expect(snapshot.affectsTelegram).toBe(false);
  expect(snapshot.affectsExecution).toBe(false);
  expect(snapshot.windows.map((w) => w.sessions)).toEqual([1, 3, 5, 20]);
}

describe("FII/DII context contract", () => {
  it("cannot acquire verdict, Telegram, or execution authority", () => {
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
});

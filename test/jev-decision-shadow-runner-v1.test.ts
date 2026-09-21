import test from "node:test";
import assert from "node:assert/strict";
import type { LiveGateEvidencePacket, LiveGateName } from "../h1-live-gate-evidence-assembler.js";
import {
  JEV_DECISION_SHADOW_RESULT_PERSIST_KIND,
  runJevDecisionShadowFromExactHistory,
  type JevDecisionShadowRunnerDeps,
} from "../jev-decision-shadow-runner-v1.js";
import { H1_LIVE_GATE_EVIDENCE_PERSIST_KIND } from "../h1-live-selector-registry.js";

const ts = "2026-09-21T10:00:00.000Z";

function packet(side: "CE" | "PE" = "CE"): LiveGateEvidencePacket {
  const gate = (value: boolean, source: string) => ({
    value,
    observedAt: ts,
    source,
    provenance: "LIVE_RUNTIME_EXACT" as const,
  });
  const gates: Record<LiveGateName, ReturnType<typeof gate>> = {
    capitalFit: gate(true, "capital"),
    liquidityOk: gate(true, "liquidity"),
    spreadOk: gate(true, "spread"),
    premiumResponseConfirmed: gate(true, "premium"),
    deltaGammaResponseConfirmed: gate(true, "delta-gamma"),
    thetaIvBurdenAcceptable: gate(true, "theta-iv"),
    multiExpiryConflictAbsent: gate(true, "multi-expiry"),
    currentOrNearExpiryUsable: gate(true, "near-expiry"),
    higherDteUsable: gate(false, "higher-dte"),
    fallbackDteApproved: gate(false, "fallback"),
  };
  return {
    identity: {
      symbol: "NIFTY",
      side,
      strike: side === "CE" ? 23400 : 23350,
      expiryDate: "2026-09-22",
      dte: 1,
      moneyness: "ATM",
      premiumLtp: side === "CE" ? 120 : 110,
      observedAt: ts,
      source: "KITE_H1_EXACT",
      provenance: "LIVE_RUNTIME_EXACT",
    },
    gates,
  };
}

test("runner loads exact persisted packets, calls Jev, and persists comparison result", async () => {
  let loadedKind = "";
  let persisted: any = null;
  let calledUrl = "";
  const deps: JevDecisionShadowRunnerDeps = {
    apiKey: "or-key",
    loadRecent: async <T>(kind: string) => {
      loadedKind = kind;
      return [packet("CE"), packet("PE")] as T[];
    },
    persistResult: async (payload) => {
      persisted = payload;
      return true;
    },
    fetchImpl: async (input) => {
      calledUrl = String(input);
      return new Response(JSON.stringify({
        answers: {
          NIFTY_CE_23400_20260922_D1_1790000000000__action: { choice: { TAKE_CANDIDATE: 0.7, NO_TRADE: 0.3 } },
        },
        model: "typesafe/jev-1.13",
        usage: { input_tokens: 200, output_tokens: 0, cost: 0.0000084 },
        id: "jev-run-1",
        provider: "typesafe",
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  };

  const result = await runJevDecisionShadowFromExactHistory({ limit: 2, symbol: "NIFTY" }, deps);
  assert.equal(result.ok, true);
  assert.equal(loadedKind, H1_LIVE_GATE_EVIDENCE_PERSIST_KIND);
  assert.equal(result.sampleCount, 2);
  assert.equal(result.persisted, true);
  assert.match(calledUrl, /openrouter\.ai\/api\/alpha\/decisions/);
  assert.equal(persisted.version, JEV_DECISION_SHADOW_RESULT_PERSIST_KIND);
  assert.equal(persisted.baseline.length, 2);
  assert.equal(persisted.safety.affectsCandidate, false);
  assert.equal(persisted.safety.affectsExecution, false);
  assert.equal(persisted.safety.createsOrders, false);
});

test("runner fails closed before DB or API work when OpenRouter key is missing", async () => {
  let loads = 0;
  let calls = 0;
  const deps: JevDecisionShadowRunnerDeps = {
    apiKey: "",
    loadRecent: async <T>() => {
      loads += 1;
      return [] as T[];
    },
    persistResult: async () => true,
    fetchImpl: async () => {
      calls += 1;
      return new Response("{}", { status: 200 });
    },
  };

  const result = await runJevDecisionShadowFromExactHistory({ limit: 2 }, deps);
  assert.equal(result.ok, false);
  assert.equal(result.blocker, "OPENROUTER_API_KEY_REQUIRED");
  assert.equal(loads, 0);
  assert.equal(calls, 0);
});

test("runner refuses to claim success if Jev result cannot be durably persisted", async () => {
  const deps: JevDecisionShadowRunnerDeps = {
    apiKey: "or-key",
    loadRecent: async <T>() => [packet("CE")] as T[],
    persistResult: async () => false,
    fetchImpl: async () => new Response(JSON.stringify({
      answers: { x: { noul: 0.5 } },
      model: "typesafe/jev-1.13",
    }), { status: 200, headers: { "content-type": "application/json" } }),
  };

  const result = await runJevDecisionShadowFromExactHistory({ limit: 1 }, deps);
  assert.equal(result.ok, false);
  assert.equal(result.persisted, false);
  assert.equal(result.blocker, "JEV_RESULT_DB_PERSISTENCE_FAILED");
});

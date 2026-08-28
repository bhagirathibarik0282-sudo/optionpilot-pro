import type { Hono } from "hono";
import { deriveClosedBlockPromotion } from "./tef-change-promotion.js";
import { deriveFamilyStateFusion } from "./family-state-fusion.js";
import { deriveEvidenceFamilies } from "./evidence-family-engine.js";
import { deriveMeaningfulCombinations } from "./meaningful-combination-engine.js";

const SYMBOLS = ["NIFTY", "BANKNIFTY", "SENSEX"] as const;
type SymbolName = typeof SYMBOLS[number];

function isSymbol(value: string): value is SymbolName {
  return (SYMBOLS as readonly string[]).includes(value);
}

async function inspectSymbol(symbol: SymbolName) {
  const [promotion, fusion, families, combinations] = await Promise.all([
    deriveClosedBlockPromotion(symbol),
    deriveFamilyStateFusion(symbol),
    deriveEvidenceFamilies(symbol),
    deriveMeaningfulCombinations(symbol),
  ]);

  return {
    symbol,
    promotion,
    fusion,
    families,
    combinations,
  };
}

export function mountTefInspectRoutes(app: Hono): void {
  app.get("/api/tef/state", async (c) => {
    c.header("Cache-Control", "no-store");
    const requested = (c.req.query("symbol") ?? "NIFTY").toUpperCase();
    if (!isSymbol(requested)) {
      return c.json({ ok: false, error: "INVALID_SYMBOL", allowed: SYMBOLS }, 400);
    }

    try {
      const state = await inspectSymbol(requested);

      return c.json({
        ok: true,
        mode: "READ_ONLY_INSPECTION",
        generatedAt: new Date().toISOString(),
        ...state,
        safety: {
          affectsVerdict: false,
          affectsTelegram: false,
          affectsExecution: false,
          createsOrders: false,
          extraMarketFetches: false,
        },
      });
    } catch (error) {
      console.error("[TEF Inspect] failed:", error instanceof Error ? error.message : error);
      return c.json({
        ok: false,
        mode: "READ_ONLY_INSPECTION",
        symbol: requested,
        error: "TEF_INSPECTION_FAILED",
        affectsVerdict: false,
        affectsTelegram: false,
        affectsExecution: false,
      }, 503);
    }
  });

  app.get("/api/tef/state/all", async (c) => {
    c.header("Cache-Control", "no-store");

    const results = await Promise.all(SYMBOLS.map(async (symbol) => {
      try {
        return { symbol, ok: true, state: await inspectSymbol(symbol) };
      } catch (error) {
        return { symbol, ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    }));

    return c.json({
      ok: results.some((r) => r.ok),
      mode: "READ_ONLY_INSPECTION",
      generatedAt: new Date().toISOString(),
      evaluationMode: "PARALLEL",
      symbolsEvaluatedInParallel: true,
      perSymbolEvidenceEvaluatedInParallel: true,
      results,
      safety: {
        affectsVerdict: false,
        affectsTelegram: false,
        affectsExecution: false,
        createsOrders: false,
        extraMarketFetches: false,
      },
    });
  });
}

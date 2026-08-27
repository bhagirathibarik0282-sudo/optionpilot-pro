import { getHaikuAuditBenchmarkV2Snapshot, HAIKU_BENCHMARK_CRITERIA } from "./haiku-audit-benchmark-v2.js";
import type { Hono } from "hono";
import type {
  CanonicalTelegramCard,
  TelegramDirection,
  TelegramEvidenceLine,
  TelegramTfState,
  TelegramSymbol,
} from "./telegram-card-contract.js";
import { TELEGRAM_INDEX_GROUP_ROUTING } from "./telegram-card-contract.js";
import { renderTelegramCardPreview } from "./telegram-card-renderer.js";
import { deriveClosedBlockPromotion } from "./tef-change-promotion.js";
import { deriveFamilyStateFusion } from "./family-state-fusion.js";
import { deriveEvidenceFamilies } from "./evidence-family-engine.js";

const SYMBOLS: readonly TelegramSymbol[] = ["NIFTY", "BANKNIFTY", "SENSEX"];

function isSymbol(value: string): value is TelegramSymbol {
  return (SYMBOLS as readonly string[]).includes(value);
}

function displayDirection(bias: string, state: string): TelegramDirection {
  if (state === "CONFLICTING") return "CONFLICTING";
  if (state === "INSUFFICIENT_DATA") return "INSUFFICIENT_DATA";
  if (bias === "BULLISH") return "BULLISH";
  if (bias === "BEARISH") return "BEARISH";
  if (bias === "MIXED") return "CONFLICTING";
  return "NEUTRAL";
}

function tfState(value: string | null | undefined): TelegramTfState {
  switch (value) {
    case "PROMOTED": return "PROMOTED";
    case "CONFIRMED": return "CONFIRMED";
    case "STRUCTURAL_SUPPORT": return "STRUCTURAL_SUPPORT";
    case "HIGHER_ORDER_SUPPORT": return "HIGHER_ORDER_SUPPORT";
    case "CONFLICTING": return "CONFLICTING";
    case "REVERSING": return "REVERSING";
    case "WARNING_ONLY": return "WARNING_ONLY";
    case "INSUFFICIENT_DATA": return "INSUFFICIENT_DATA";
    default: return "UNAVAILABLE";
  }
}

function evidenceFromFamilies(
  families: Array<{ id: string; name: string; state: string; reasons?: string[] }>,
  ids: readonly string[],
): TelegramEvidenceLine[] {
  return families
    .filter((family) => ids.includes(family.id))
    .map((family) => ({
      label: family.name,
      state: ["SUPPORTIVE", "NEUTRAL", "WARNING", "CONFLICTING", "UNAVAILABLE"].includes(family.state)
        ? family.state as TelegramEvidenceLine["state"]
        : "UNAVAILABLE",
      detail: family.reasons?.[0] ?? null,
    }));
}

export function mountTelegramPreviewRoutes(app: Hono): void {
  app.get("/api/research/haiku-audit-benchmark-v2", (c) => {
    c.header("Cache-Control", "no-store");
    return c.json({ ok: true, mode: "RESEARCH_ONLY", automaticPromotionAllowed: false, affectsVerdict: false, affectsTelegram: false, affectsExecution: false, criteria: HAIKU_BENCHMARK_CRITERIA, benchmark: getHaikuAuditBenchmarkV2Snapshot() });
  });

  app.get("/api/telegram/preview", async (c) => {
    c.header("Cache-Control", "no-store");
    const requested = (c.req.query("symbol") ?? "NIFTY").toUpperCase();

    if (!isSymbol(requested)) {
      return c.json({ ok: false, error: "INVALID_SYMBOL", allowed: SYMBOLS }, 400);
    }

    try {
      const [promotion, fusion, familyResult] = await Promise.all([
        deriveClosedBlockPromotion(requested),
        deriveFamilyStateFusion(requested),
        deriveEvidenceFamilies(requested),
      ]);

      const coreIds = ["PRICE_STRUCTURE", "OPTION_PREMIUM_REALITY"] as const;
      const contextIds = ["VOLATILITY_GREEKS", "POSITIONING", "MULTI_EXPIRY", "BREADTH_REGIME"] as const;
      const allFamilies = familyResult.families ?? [];

      const card: CanonicalTelegramCard = {
        schemaVersion: "TELEGRAM_CARD_V1",
        symbol: requested,
        generatedAt: new Date().toISOString(),
        routing: {
          groupName: TELEGRAM_INDEX_GROUP_ROUTING[requested],
          strictIndexIsolation: true,
          crossPostAllowed: false,
        },
        headline: {
          verdict: displayDirection(fusion.bias, fusion.state),
          confidenceLabel: "UNAVAILABLE",
          truth: "PARTIAL",
          freshnessSeconds: null,
        },
        timeframe: {
          m1: promotion.oneMinute?.state === "INSUFFICIENT_DATA" ? "INSUFFICIENT_DATA" : "WARNING_ONLY",
          m3: tfState(promotion.tf3m),
          m15: tfState(promotion.tf15m),
          m30: tfState(promotion.tf30m),
          m60: tfState(promotion.tf60m),
        },
        coreEvidence: evidenceFromFamilies(allFamilies, coreIds),
        contextEvidence: evidenceFromFamilies(allFamilies, contextIds),
        conflicts: fusion.conflictingFamilies ?? [],
        warnings: fusion.warningFamilies ?? [],
        candidate: {
          side: "NONE",
          strike: null,
          expiry: null,
          dte: null,
          premium: null,
          health: "UNAVAILABLE",
        },
        tradePlan: {
          entry: null,
          sl: null,
          t1: null,
          t2: null,
          t3: null,
          rrToT1: null,
          rrToT2: null,
          rrToT3: null,
          status: "UNAVAILABLE",
        },
        reasons: promotion.reasons ?? [],
        nextUpdateAt: null,
        safety: {
          forwardTestingOnly: true,
          affectsVerdict: false,
          affectsExecution: false,
        },
      };

      return c.json({
        ok: true,
        mode: "READ_ONLY_TELEGRAM_PREVIEW",
        source: "TEF_EVIDENCE_PREVIEW_NOT_FINAL_VERDICT",
        symbol: requested,
        destinationGroup: TELEGRAM_INDEX_GROUP_ROUTING[requested],
        message: renderTelegramCardPreview(card),
        card,
        safety: {
          sendsTelegram: false,
          affectsVerdict: false,
          affectsTelegram: false,
          affectsExecution: false,
          createsOrders: false,
          extraMarketFetches: false,
        },
      });
    } catch (error) {
      console.error("[Telegram Preview] failed:", error instanceof Error ? error.message : error);
      return c.json({
        ok: false,
        mode: "READ_ONLY_TELEGRAM_PREVIEW",
        symbol: requested,
        error: "TELEGRAM_PREVIEW_FAILED",
        sendsTelegram: false,
        affectsVerdict: false,
        affectsTelegram: false,
        affectsExecution: false,
      }, 503);
    }
  });
}

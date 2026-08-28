import type { Hono } from "hono";
import type {
  CanonicalTelegramCard,
  TelegramDirection,
  TelegramEvidenceLine,
  TelegramTfState,
  TelegramSymbol,
} from "./telegram-card-contract.js";
import { TELEGRAM_INDEX_GROUP_ROUTING } from "./telegram-card-contract.js";
import { renderTelegramCardV2 } from "./telegram-card-renderer-v2.js";
import { sendTelegramCardV2 } from "./telegram-sender-v2.js";
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

async function buildCard(requested: TelegramSymbol, routingTest: boolean): Promise<CanonicalTelegramCard> {
  const [promotion, fusion, familyResult] = await Promise.all([
    deriveClosedBlockPromotion(requested),
    deriveFamilyStateFusion(requested),
    deriveEvidenceFamilies(requested),
  ]);

  const coreIds = ["PRICE_STRUCTURE", "OPTION_PREMIUM_REALITY"] as const;
  const contextIds = ["VOLATILITY_GREEKS", "POSITIONING", "MULTI_EXPIRY", "BREADTH_REGIME"] as const;
  const allFamilies = familyResult.families ?? [];

  return {
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
    reasons: routingTest
      ? ["ROUTING TEST ONLY — NOT A TRADE SIGNAL"]
      : (promotion.reasons ?? []),
    nextUpdateAt: null,
    safety: {
      forwardTestingOnly: true,
      affectsVerdict: false,
      affectsExecution: false,
    },
  };
}

export function mountTelegramPreviewRoutes(app: Hono): void {
  app.get("/api/telegram/routing-test-page", (c) => {
    c.header("Cache-Control", "no-store");
    return c.html(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Telegram Routing Test</title><style>body{font-family:system-ui;margin:18px;max-width:520px}input,select,button{width:100%;box-sizing:border-box;padding:14px;margin:8px 0;font-size:16px}button{font-weight:700}pre{white-space:pre-wrap;background:#111;color:#eee;padding:12px;border-radius:8px;min-height:120px}.warn{font-weight:700}</style></head><body><h2>Telegram Routing Test</h2><p class="warn">ROUTING TEST ONLY — NOT A TRADE SIGNAL</p><select id="symbol"><option>NIFTY</option><option>BANKNIFTY</option><option>SENSEX</option></select><input id="key" type="password" autocomplete="off" placeholder="Routing test secret key"><button id="send">SEND TEST</button><pre id="out">Ready</pre><script>const out=document.getElementById('out');document.getElementById('send').onclick=async()=>{const symbol=document.getElementById('symbol').value;const key=document.getElementById('key').value.trim();if(!key){out.textContent='Enter routing test key';return;}out.textContent='Sending...';try{const r=await fetch('/api/telegram/routing-test?symbol='+encodeURIComponent(symbol),{method:'POST',headers:{'x-telegram-routing-test-key':key}});const j=await r.json();out.textContent=JSON.stringify(j,null,2);}catch(e){out.textContent=String(e);}};</script></body></html>`);
  });

  app.get("/api/telegram/preview", async (c) => {
    c.header("Cache-Control", "no-store");
    const requested = (c.req.query("symbol") ?? "NIFTY").toUpperCase();

    if (!isSymbol(requested)) {
      return c.json({ ok: false, error: "INVALID_SYMBOL", allowed: SYMBOLS }, 400);
    }

    try {
      const card = await buildCard(requested, false);
      const senderSimulation = await sendTelegramCardV2(card, { dryRun: true });

      return c.json({
        ok: true,
        mode: "READ_ONLY_TELEGRAM_V2_PREVIEW",
        source: "TEF_EVIDENCE_PREVIEW_NOT_FINAL_VERDICT",
        symbol: requested,
        destinationGroup: TELEGRAM_INDEX_GROUP_ROUTING[requested],
        strictIndexIsolation: true,
        crossPostAllowed: false,
        message: renderTelegramCardV2(card),
        senderSimulation,
        card,
        safety: {
          sendsTelegram: false,
          senderDryRun: true,
          affectsVerdict: false,
          affectsTelegram: false,
          affectsExecution: false,
          createsOrders: false,
          extraMarketFetches: false,
        },
      });
    } catch (error) {
      console.error("[Telegram V2 Preview] failed:", error instanceof Error ? error.message : error);
      return c.json({
        ok: false,
        mode: "READ_ONLY_TELEGRAM_V2_PREVIEW",
        symbol: requested,
        error: "TELEGRAM_V2_PREVIEW_FAILED",
        sendsTelegram: false,
        affectsVerdict: false,
        affectsTelegram: false,
        affectsExecution: false,
      }, 503);
    }
  });

  app.post("/api/telegram/routing-test", async (c) => {
    c.header("Cache-Control", "no-store");
    const requested = (c.req.query("symbol") ?? "").toUpperCase();
    const testEnabled = process.env.TELEGRAM_TEST_SEND_ENABLED === "true";
    const expectedKey = process.env.TELEGRAM_ROUTING_TEST_KEY?.trim() ?? "";
    const suppliedKey = c.req.header("x-telegram-routing-test-key")?.trim() ?? "";

    if (!isSymbol(requested)) {
      return c.json({ ok: false, error: "INVALID_SYMBOL", allowed: SYMBOLS, sendsTelegram: false }, 400);
    }

    if (!testEnabled || !expectedKey || suppliedKey !== expectedKey) {
      return c.json({
        ok: false,
        error: "TELEGRAM_ROUTING_TEST_BLOCKED",
        required: {
          method: "POST",
          env: ["TELEGRAM_TEST_SEND_ENABLED=true", "TELEGRAM_ROUTING_TEST_KEY=<secret>"],
          header: "x-telegram-routing-test-key",
        },
        sendsTelegram: false,
      }, 403);
    }

    try {
      const card = await buildCard(requested, true);
      const result = await sendTelegramCardV2(card, { dryRun: false });

      return c.json({
        ok: result.ok,
        mode: "CONTROLLED_TELEGRAM_ROUTING_TEST",
        source: "MANUAL_ROUTING_TEST_NOT_TRADE_SIGNAL",
        symbol: requested,
        destinationGroup: TELEGRAM_INDEX_GROUP_ROUTING[requested],
        strictIndexIsolation: true,
        crossPostAllowed: false,
        message: renderTelegramCardV2(card),
        senderResult: result,
        safety: {
          sendsTelegram: result.ok && result.sent,
          manualRoutingTestOnly: true,
          affectsVerdict: false,
          affectsTelegram: result.ok && result.sent,
          affectsExecution: false,
          createsOrders: false,
          extraMarketFetches: false,
        },
      }, result.ok ? 200 : 502);
    } catch (error) {
      console.error("[Telegram Routing Test] failed:", error instanceof Error ? error.message : error);
      return c.json({
        ok: false,
        mode: "CONTROLLED_TELEGRAM_ROUTING_TEST",
        symbol: requested,
        error: "TELEGRAM_ROUTING_TEST_FAILED",
        sendsTelegram: false,
        affectsVerdict: false,
        affectsTelegram: false,
        affectsExecution: false,
      }, 503);
    }
  });
}

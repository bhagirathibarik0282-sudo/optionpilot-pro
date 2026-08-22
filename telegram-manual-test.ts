// OptionPilot Pro — one-shot Telegram delivery test.
// Safe by design: no imports from server.ts, no trading/scoring logic,
// no scheduler, no loop, no secret logging, and exactly one sendMessage call.

const allowedSymbols = new Set(["NIFTY", "BANKNIFTY", "SENSEX", "SHARED", "PREMIUM_ONLY"]);

function resolveChatId(target: string): string | null {
  if (target === "NIFTY") return process.env.TELEGRAM_CHAT_ID_NIFTY?.trim() || process.env.TELEGRAM_CHAT_ID?.trim() || null;
  if (target === "BANKNIFTY") return process.env.TELEGRAM_CHAT_ID_BANKNIFTY?.trim() || process.env.TELEGRAM_CHAT_ID?.trim() || null;
  if (target === "SENSEX") return process.env.TELEGRAM_CHAT_ID_SENSEX?.trim() || process.env.TELEGRAM_CHAT_ID?.trim() || null;
  if (target === "PREMIUM_ONLY") return process.env.TELEGRAM_CHAT_ID_PREMIUM_ONLY?.trim() || null;
  return process.env.TELEGRAM_CHAT_ID?.trim() || null;
}

async function main() {
  const target = String(process.argv[2] || "SHARED").trim().toUpperCase();
  if (!allowedSymbols.has(target)) {
    console.error("[Telegram Test] Invalid target. Use NIFTY, BANKNIFTY, SENSEX, SHARED, or PREMIUM_ONLY.");
    process.exitCode = 2;
    return;
  }

  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) {
    console.error("[Telegram Test] TELEGRAM_BOT_TOKEN is not configured.");
    process.exitCode = 3;
    return;
  }

  const chatId = resolveChatId(target);
  if (!chatId) {
    console.error(`[Telegram Test] No Telegram chat ID configured for ${target}.`);
    process.exitCode = 4;
    return;
  }

  const text = [
    "🧪 <b>OptionPilot Pro — Telegram Test</b>",
    "Connection verified.",
    "Haiku Evidence Architecture: Shadow Mode",
    "✅ Telegram delivery path operational",
    "⚠️ <b>TEST ONLY — NO TRADE ACTION</b>"
  ].join("\n");

  let response: Response;
  try {
    response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" })
    });
  } catch (error) {
    console.error("[Telegram Test] Network failure:", error instanceof Error ? error.message : String(error));
    process.exitCode = 5;
    return;
  }

  const body = await response.json().catch(() => null) as any;
  if (!response.ok || body?.ok !== true) {
    const description = typeof body?.description === "string" ? body.description : `HTTP ${response.status}`;
    console.error(`[Telegram Test] Telegram rejected the message: ${description}`);
    process.exitCode = 6;
    return;
  }

  const messageId = body?.result?.message_id;
  if (typeof messageId !== "number") {
    console.error("[Telegram Test] Telegram returned success without a valid message_id.");
    process.exitCode = 7;
    return;
  }

  console.log(`[Telegram Test] SUCCESS target=${target} message_id=${messageId}`);
}

main().catch((error) => {
  console.error("[Telegram Test] Unexpected failure:", error instanceof Error ? error.message : String(error));
  process.exitCode = 8;
});

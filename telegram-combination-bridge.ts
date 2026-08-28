import { deriveMeaningfulCombinations, type MeaningfulCombinationSnapshot } from "./meaningful-combination-engine.js";

// Display-only bridge for the existing 1-minute Telegram market snapshot.
// It NEVER changes verdict, score, trade plan, execution, or the underlying
// market message. It only appends the already-built COMB-01..08 evidence lens.
// Fail-closed: any DB/derivation/formatting problem sends the original message.

const LAST_ENRICHED_MINUTE = new Map<string, string>();
const MAX_TELEGRAM_TEXT = 4096;
const SAFE_TEXT_LIMIT = 3980;
const INSTALL_FLAG = "__OPTIONPILOT_TELEGRAM_COMBINATION_BRIDGE__";

type SupportedSymbol = "NIFTY" | "BANKNIFTY" | "SENSEX";

type TelegramPayload = {
  chat_id?: string | number;
  text?: string;
  parse_mode?: string;
  [key: string]: unknown;
};

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function inferSymbol(text: string): SupportedSymbol | null {
  if (/\bBANKNIFTY\b/.test(text)) return "BANKNIFTY";
  if (/\bSENSEX\b/.test(text)) return "SENSEX";
  if (/\bNIFTY\b/.test(text)) return "NIFTY";
  return null;
}

function looksLikeFastMarketSnapshot(text: string): boolean {
  if (text.includes("COMB-01") || text.includes("Combination Evidence")) return false;
  const markers = ["PCR", "Wall", "Intrinsic", "Extrinsic", "OI"];
  return markers.filter((m) => text.includes(m)).length >= 3;
}

function minuteBucket(): string {
  return new Date().toISOString().slice(0, 16);
}

function stateIcon(state: string): string {
  if (state === "SUPPORTIVE") return "✅";
  if (state === "WARNING") return "⚠️";
  if (state === "CONFLICTING") return "🔀";
  if (state === "NEUTRAL") return "➖";
  return "⚪";
}

function clip(text: string, max = 92): string {
  const clean = text.replace(/[<>]/g, "").replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : clean.slice(0, max - 1) + "…";
}

function formatCombinationEvidence(snapshot: MeaningfulCombinationSnapshot): string {
  const lines = snapshot.combinations.map((c) => {
    const reason = c.reasons[0] ? ` — ${clip(c.reasons[0])}` : "";
    return `${c.id} ${stateIcon(c.state)} ${c.state}/${c.bias}${reason}`;
  });
  return [
    "🧩 <b>Combination Evidence (display-only)</b>",
    ...lines,
    `Coverage: ${snapshot.availableCount}/8 | Warnings: ${snapshot.warningCount} | Conflicts: ${snapshot.conflictCount}`,
    "<i>Forward-test evidence only — does not alter verdict or execution.</i>",
  ].join("\n");
}

export function installTelegramCombinationBridge(): void {
  const holder = globalThis as typeof globalThis & Record<string, unknown>;
  if (holder[INSTALL_FLAG] === true) return;
  holder[INSTALL_FLAG] = true;

  const originalFetch = globalThis.fetch.bind(globalThis);

  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    try {
      const url = requestUrl(input);
      if (!url.includes("api.telegram.org/") || !url.includes("/sendMessage") || typeof init?.body !== "string") {
        return originalFetch(input, init);
      }

      const payload = JSON.parse(init.body) as TelegramPayload;
      const text = typeof payload.text === "string" ? payload.text : "";
      const symbol = inferSymbol(text);
      if (!symbol || !looksLikeFastMarketSnapshot(text)) return originalFetch(input, init);

      const dedupeKey = `${String(payload.chat_id ?? "")}:${symbol}`;
      const bucket = minuteBucket();
      if (LAST_ENRICHED_MINUTE.get(dedupeKey) === bucket) return originalFetch(input, init);

      const snapshot = await deriveMeaningfulCombinations(symbol);
      const evidence = formatCombinationEvidence(snapshot);
      LAST_ENRICHED_MINUTE.set(dedupeKey, bucket);

      const combined = `${text}\n━━━━━━━━━━━━━━━━━━━━\n${evidence}`;
      if (combined.length <= SAFE_TEXT_LIMIT) {
        return originalFetch(input, { ...init, body: JSON.stringify({ ...payload, text: combined }) });
      }

      // Existing production chunk is near Telegram's 4096-char ceiling:
      // preserve it byte-for-byte, then send evidence as one compact follow-up.
      const first = await originalFetch(input, init);
      if (evidence.length <= MAX_TELEGRAM_TEXT) {
        await originalFetch(input, { ...init, body: JSON.stringify({ ...payload, text: evidence }) });
      }
      return first;
    } catch (err) {
      console.error("[Telegram Combination Bridge] enrichment failed closed:", err instanceof Error ? err.message : String(err));
      return originalFetch(input, init);
    }
  }) as typeof fetch;
}

import fs from "node:fs";

const path = "server.ts";
let src = fs.readFileSync(path, "utf8");
const marker = "PHASE74_TELEGRAM_LIVE_V2";
if (src.includes(marker)) {
  console.log("Phase74 Telegram Live V2 already present");
  process.exit(0);
}

const anchor = `                const validation = validateDataServer(symbol, m, session, null);\n                runRuleEngineServer(symbol, m, validation, null);`;
const count = src.split(anchor).length - 1;
if (count !== 1) {
  throw new Error(`Phase74 blocker: Phase60 canonical observer anchor count ${count}; refusing ambiguous patch`);
}

const replacement = `                const validation = validateDataServer(symbol, m, session, null);\n                const rule = runRuleEngineServer(symbol, m, validation, null);\n\n                // PHASE74_TELEGRAM_LIVE_V2\n                // Telegram-only observability. Reuses the canonical validation + rule result above.\n                // No extra market fetch, no second scoring formula, no dashboard mutation, no execution change.\n                if (/^(1|true|yes|on)$/i.test(String(process.env.PHASE74_TELEGRAM_LIVE_V2 ?? \"\"))) {\n                  void import(\"./telegram-live-status-v2.js\")\n                    .then(({ publishPhase74TelegramLiveV2 }) => publishPhase74TelegramLiveV2({\n                      symbol,\n                      metrics: m,\n                      validation,\n                      rule,\n                      anthropicApiKey: process.env.ANTHROPIC_API_KEY || null,\n                    }))\n                    .then((delivery) => {\n                      if (delivery.sent || delivery.edited) {\n                        console.log(\"[PHASE74_TELEGRAM_LIVE_V2]\", symbol, delivery.reason);\n                      } else if (delivery.reason !== \"NO_MEANINGFUL_CHANGE\") {\n                        console.warn(\"[PHASE74_TELEGRAM_LIVE_V2]\", symbol, delivery.reason);\n                      }\n                    })\n                    .catch((phase74Error) => {\n                      console.error(\"[PHASE74_TELEGRAM_LIVE_V2]\", symbol, phase74Error instanceof Error ? phase74Error.message : phase74Error);\n                    });\n                }`;

src = src.replace(anchor, replacement);

for (const required of [
  marker,
  "const rule = runRuleEngineServer(symbol, m, validation, null);",
  "publishPhase74TelegramLiveV2",
  "process.env.PHASE74_TELEGRAM_LIVE_V2",
  "process.env.ANTHROPIC_API_KEY",
]) {
  if (!src.includes(required)) throw new Error(`Phase74 verification failed: missing ${required}`);
}

const start = src.indexOf(marker);
const block = src.slice(start, start + 5000);
for (const forbidden of [
  "refreshMarketSnapshot(",
  "validateDataServer(",
  "runRuleEngineServer(",
  "placeOrder(",
  "executeTrade(",
  "app.get(",
  "app.post(",
]) {
  if (block.includes(forbidden)) throw new Error(`Phase74 P0: forbidden duplicate/side-effect inside publisher block: ${forbidden}`);
}

if ((src.match(/const rule = runRuleEngineServer\(symbol, m, validation, null\);/g) || []).length !== 1) {
  throw new Error("Phase74 P0: canonical observer rule call is not unique after patch");
}

fs.writeFileSync(path, src);
console.log("Phase74 Telegram Live V2 safely wired into existing three-index Phase60 observer");

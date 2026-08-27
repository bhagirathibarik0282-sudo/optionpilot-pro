import fs from "node:fs";

const src = fs.readFileSync("server.ts", "utf8");

const needles = [
  "sendTelegramAlert",
  "sendTelegramPremiumOnlyMessage",
  "editTelegramPremiumOnlyMessage",
  "TELEGRAM_CHAT_ID",
  "TELEGRAM",
  "ANTHROPIC",
  "anthropic",
  "claude",
  "haiku",
  "messages.create",
  "/v1/messages",
  "refreshMarketSnapshot",
  "setInterval",
];

function lineNumberAt(index) {
  return src.slice(0, index).split("\n").length;
}

function sanitize(text) {
  return text
    .replace(/(sk-ant-[A-Za-z0-9_-]+)/g, "[REDACTED_ANTHROPIC_KEY]")
    .replace(/(bot\d+:[A-Za-z0-9_-]+)/g, "[REDACTED_TELEGRAM_TOKEN]")
    .replace(/(['\"](?:token|api[_-]?key|secret)['\"]?\s*[:=]\s*['\"])[^'\"]+(['\"])/gi, "$1[REDACTED]$2");
}

const findings = [];
for (const needle of needles) {
  let pos = 0;
  let count = 0;
  const samples = [];
  while (true) {
    const idx = src.indexOf(needle, pos);
    if (idx < 0) break;
    count++;
    if (samples.length < 8) {
      const start = Math.max(0, src.lastIndexOf("\n", Math.max(0, idx - 500)) + 1);
      let end = src.indexOf("\n", idx + 700);
      if (end < 0) end = Math.min(src.length, idx + 700);
      samples.push({ line: lineNumberAt(idx), context: sanitize(src.slice(start, end)) });
    }
    pos = idx + needle.length;
  }
  findings.push({ needle, count, samples });
}

const telegramFiles = [
  "telegram-card-contract.ts",
  "telegram-card-renderer.ts",
  "telegram-preview-route.ts",
  "telegram-trade-card.ts",
].map((path) => ({ path, exists: fs.existsSync(path), bytes: fs.existsSync(path) ? fs.statSync(path).size : 0 }));

const report = {
  version: "PHASE74_TELEGRAM_BACKGROUND_AUDIT_V1",
  architectureRole: "STATIC_SOURCE_AUDIT_ONLY",
  productionImpact: "NONE",
  mutationAllowed: false,
  sendsTelegram: false,
  callsHaiku: false,
  dashboardChanges: false,
  telegramFiles,
  findings,
};

console.log(JSON.stringify(report, null, 2));

for (const required of ["sendTelegramPremiumOnlyMessage", "refreshMarketSnapshot"]) {
  const hit = findings.find((x) => x.needle === required);
  if (!hit || hit.count === 0) throw new Error(`Phase74 audit blocker: missing ${required}`);
}

if (!telegramFiles.every((x) => x.exists)) throw new Error("Phase74 audit blocker: canonical Telegram modules missing");

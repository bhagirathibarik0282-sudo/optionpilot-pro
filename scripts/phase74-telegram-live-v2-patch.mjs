import fs from "node:fs";

const path = "server.ts";
let src = fs.readFileSync(path, "utf8");
const marker = "PHASE74_TELEGRAM_LIVE_V2";
if (src.includes(marker)) {
  console.log("Phase74 Telegram Live V2 already present");
  process.exit(0);
}

const verdictAnchor = "const verdict = rule.verdict;";
const verdictPositions = [];
let seek = 0;
while (true) {
  const at = src.indexOf(verdictAnchor, seek);
  if (at < 0) break;
  verdictPositions.push(at);
  seek = at + verdictAnchor.length;
}
if (!verdictPositions.length) throw new Error("Phase74 blocker: no canonical verdict anchor found");

const candidates = [];
for (const verdictAt of verdictPositions) {
  const contextStart = Math.max(0, verdictAt - 7000);
  const prefix = src.slice(contextStart, verdictAt);
  const validationMatches = [...prefix.matchAll(/const\s+([A-Za-z_$][\w$]*)\s*=\s*validateDataServer\(\s*symbol\s*,\s*([A-Za-z_$][\w$]*)\s*,\s*session\s*,\s*null(?:\s*,[^)]*)?\)\s*;/g)];
  if (!validationMatches.length) continue;
  const validationMatch = validationMatches[validationMatches.length - 1];
  const validationVar = validationMatch[1];
  const metricsVar = validationMatch[2];
  const rulePattern = new RegExp(`const\\s+rule\\s*=\\s*runRuleEngineServer\\(\\s*symbol\\s*,\\s*${metricsVar}\\s*,\\s*${validationVar}\\s*,\\s*null\\s*\\)\\s*;`, "g");
  const ruleMatches = [...prefix.matchAll(rulePattern)];
  if (!ruleMatches.length) continue;
  const scheduleNear = src.lastIndexOf("scheduleAutoTradeManager", verdictAt);
  const distanceToSchedule = scheduleNear >= 0 ? verdictAt - scheduleNear : Number.POSITIVE_INFINITY;
  candidates.push({ verdictAt, validationVar, metricsVar, scheduleNear, distanceToSchedule });
}

const managerCandidates = candidates.filter((c) => c.scheduleNear >= 0 && c.distanceToSchedule < 120000);
const usable = managerCandidates.length === 1 ? managerCandidates : candidates;
if (usable.length !== 1) {
  throw new Error(`Phase74 blocker: canonical decision candidates=${candidates.length}, manager-near=${managerCandidates.length}; refusing ambiguous patch`);
}
const { verdictAt, validationVar, metricsVar } = usable[0];

const insertion = `// PHASE74_TELEGRAM_LIVE_V2\n      // Display/observability only. Reuses the already-computed canonical validator + rule result.\n      // It does not call the rule engine again, alter score/verdict/candidate/trade-plan, touch dashboard,\n      // place orders, or change the existing Telegram trade-card path. Default OFF until explicitly enabled.\n      if (String(process.env.PHASE74_TELEGRAM_LIVE_V2 || \"\").toLowerCase() === \"true\") {\n        try {\n          const { buildPhase74CanonicalStatus, explainPhase74WithHaiku, renderPhase74TelegramStatus } = await import(\"./telegram-live-status-v2.js\");\n          const phase74Status = buildPhase74CanonicalStatus({\n            symbol,\n            observedAt: new Date().toISOString(),\n            metrics: ${metricsVar},\n            validation: ${validationVar},\n            rule,\n          });\n\n          const phase74Session = session as any;\n          if (!phase74Session.__phase74TelegramLiveV2) phase74Session.__phase74TelegramLiveV2 = {};\n          const phase74Store = phase74Session.__phase74TelegramLiveV2 as Record<string, any>;\n          const phase74Now = Date.now();\n          const phase74Ist = new Date(phase74Now + 330 * 60 * 1000);\n          const phase74DayKey = phase74Ist.toISOString().slice(0, 10);\n          const phase74Existing = phase74Store[symbol];\n          const phase74NewDay = !phase74Existing || phase74Existing.dayKey !== phase74DayKey;\n          const phase74AiChanged = phase74NewDay || phase74Existing.aiSignature !== phase74Status.aiSignature;\n\n          let phase74Explanation = phase74Existing?.explanation || phase74Status.deterministicExplanation;\n          let phase74ExplanationSource: \"HAIKU\" | \"DETERMINISTIC_FALLBACK\" = phase74Existing?.explanationSource || \"DETERMINISTIC_FALLBACK\";\n          if (phase74AiChanged) {\n            const phase74Explained = await explainPhase74WithHaiku(phase74Status, process.env.ANTHROPIC_API_KEY || null);\n            phase74Explanation = phase74Explained.explanation;\n            phase74ExplanationSource = phase74Explained.source;\n          }\n\n          const phase74Text = renderPhase74TelegramStatus(phase74Status, phase74Explanation, phase74ExplanationSource);\n          const phase74ThrottleElapsed = !phase74Existing || phase74Now - Number(phase74Existing.lastEditAt || 0) >= 180_000;\n          const phase74DisplayChanged = !phase74Existing || phase74Existing.displaySignature !== phase74Status.displaySignature;\n\n          if (phase74NewDay || !phase74Existing?.messageId) {\n            const phase74MessageId = await sendTelegramPremiumOnlyMessage(session, phase74Text);\n            phase74Store[symbol] = {\n              dayKey: phase74DayKey, messageId: phase74MessageId, aiSignature: phase74Status.aiSignature,\n              displaySignature: phase74Status.displaySignature, explanation: phase74Explanation,\n              explanationSource: phase74ExplanationSource, lastEditAt: phase74Now,\n            };\n          } else if (phase74AiChanged || (phase74DisplayChanged && phase74ThrottleElapsed)) {\n            const phase74Edited = await editTelegramPremiumOnlyMessage(session, phase74Existing.messageId, phase74Text);\n            if (phase74Edited) {\n              phase74Store[symbol] = {\n                ...phase74Existing, dayKey: phase74DayKey, aiSignature: phase74Status.aiSignature,\n                displaySignature: phase74Status.displaySignature, explanation: phase74Explanation,\n                explanationSource: phase74ExplanationSource, lastEditAt: phase74Now,\n              };\n            }\n          }\n        } catch (phase74Error) {\n          console.error(\"[PHASE74_TELEGRAM_LIVE_V2]\", phase74Error instanceof Error ? phase74Error.message : phase74Error);\n        }\n      }\n\n      `;

src = src.slice(0, verdictAt) + insertion + src.slice(verdictAt);

for (const required of [
  marker,
  'process.env.PHASE74_TELEGRAM_LIVE_V2',
  'buildPhase74CanonicalStatus',
  'explainPhase74WithHaiku',
  'renderPhase74TelegramStatus',
  'sendTelegramPremiumOnlyMessage(session, phase74Text)',
  'editTelegramPremiumOnlyMessage(session, phase74Existing.messageId, phase74Text)',
  '180_000',
]) {
  if (!src.includes(required)) throw new Error(`Phase74 verification failed: missing ${required}`);
}

const insertedStart = src.indexOf(marker);
const insertedEnd = src.indexOf(verdictAnchor, insertedStart);
const insertedOnly = src.slice(insertedStart, insertedEnd);
for (const forbidden of ["placeOrder(", "executeTrade(", "refreshMarketSnapshot(", "app.get(", "app.post(", "runRuleEngineServer(", "validateDataServer("]) {
  if (insertedOnly.includes(forbidden)) throw new Error(`Phase74 P0: forbidden behavior added: ${forbidden}`);
}

fs.writeFileSync(path, src);
console.log(`Phase74 Telegram Live V2 patch applied safely using metrics=${metricsVar}, validation=${validationVar}`);

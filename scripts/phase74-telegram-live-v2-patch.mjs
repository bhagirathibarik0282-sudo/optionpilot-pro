import fs from "node:fs";

const path = "server.ts";
let src = fs.readFileSync(path, "utf8");
const marker = "PHASE74_TELEGRAM_LIVE_V2";
if (src.includes(marker)) {
  console.log("Phase74 Telegram Live V2 already present");
  process.exit(0);
}

const fnStart = src.indexOf("scheduleAutoTradeManager");
if (fnStart < 0) throw new Error("Phase74 blocker: scheduleAutoTradeManager not found");
const nextFn = src.indexOf("\nfunction ", fnStart + 32);
const nextAsyncFn = src.indexOf("\nasync function ", fnStart + 32);
const candidates = [nextFn, nextAsyncFn].filter((x) => x > fnStart);
const fnEnd = candidates.length ? Math.min(...candidates) : Math.min(src.length, fnStart + 50000);
let block = src.slice(fnStart, fnEnd);

const anchor = `      const validation = validateDataServer(symbol, metrics, session, null);\n      const rule = runRuleEngineServer(symbol, metrics, validation, null);\n      const verdict = rule.verdict;`;
const count = block.split(anchor).length - 1;
if (count !== 1) throw new Error(`Phase74 blocker: canonical validator/rule anchor count ${count}; refusing ambiguous patch`);

const insertion = `      const validation = validateDataServer(symbol, metrics, session, null);\n      const rule = runRuleEngineServer(symbol, metrics, validation, null);\n\n      // PHASE74_TELEGRAM_LIVE_V2\n      // Display/observability only. Reuses the already-computed canonical validator + rule result.\n      // It does not call the rule engine again, alter score/verdict/candidate/trade-plan, touch dashboard,\n      // place orders, or change the existing Telegram trade-card path. Default OFF until explicitly enabled.\n      if (String(process.env.PHASE74_TELEGRAM_LIVE_V2 || \"\").toLowerCase() === \"true\") {\n        try {\n          const { buildPhase74CanonicalStatus, explainPhase74WithHaiku, renderPhase74TelegramStatus } = await import(\"./telegram-live-status-v2.js\");\n          const phase74Status = buildPhase74CanonicalStatus({\n            symbol,\n            observedAt: new Date().toISOString(),\n            metrics,\n            validation,\n            rule,\n          });\n\n          const phase74Session = session as any;\n          if (!phase74Session.__phase74TelegramLiveV2) phase74Session.__phase74TelegramLiveV2 = {};\n          const phase74Store = phase74Session.__phase74TelegramLiveV2 as Record<string, any>;\n          const phase74Now = Date.now();\n          const phase74Ist = new Date(phase74Now + 330 * 60 * 1000);\n          const phase74DayKey = phase74Ist.toISOString().slice(0, 10);\n          const phase74Existing = phase74Store[symbol];\n          const phase74NewDay = !phase74Existing || phase74Existing.dayKey !== phase74DayKey;\n          const phase74AiChanged = phase74NewDay || phase74Existing.aiSignature !== phase74Status.aiSignature;\n\n          let phase74Explanation = phase74Existing?.explanation || phase74Status.deterministicExplanation;\n          let phase74ExplanationSource: \"HAIKU\" | \"DETERMINISTIC_FALLBACK\" = phase74Existing?.explanationSource || \"DETERMINISTIC_FALLBACK\";\n          if (phase74AiChanged) {\n            const phase74Explained = await explainPhase74WithHaiku(phase74Status, process.env.ANTHROPIC_API_KEY || null);\n            phase74Explanation = phase74Explained.explanation;\n            phase74ExplanationSource = phase74Explained.source;\n          }\n\n          const phase74Text = renderPhase74TelegramStatus(phase74Status, phase74Explanation, phase74ExplanationSource);\n          const phase74ThrottleElapsed = !phase74Existing || phase74Now - Number(phase74Existing.lastEditAt || 0) >= 180_000;\n          const phase74DisplayChanged = !phase74Existing || phase74Existing.displaySignature !== phase74Status.displaySignature;\n\n          if (phase74NewDay || !phase74Existing?.messageId) {\n            const phase74MessageId = await sendTelegramPremiumOnlyMessage(session, phase74Text);\n            phase74Store[symbol] = {\n              dayKey: phase74DayKey,\n              messageId: phase74MessageId,\n              aiSignature: phase74Status.aiSignature,\n              displaySignature: phase74Status.displaySignature,\n              explanation: phase74Explanation,\n              explanationSource: phase74ExplanationSource,\n              lastEditAt: phase74Now,\n            };\n          } else if (phase74AiChanged || (phase74DisplayChanged && phase74ThrottleElapsed)) {\n            const phase74Edited = await editTelegramPremiumOnlyMessage(session, phase74Existing.messageId, phase74Text);\n            if (phase74Edited) {\n              phase74Store[symbol] = {\n                ...phase74Existing,\n                dayKey: phase74DayKey,\n                aiSignature: phase74Status.aiSignature,\n                displaySignature: phase74Status.displaySignature,\n                explanation: phase74Explanation,\n                explanationSource: phase74ExplanationSource,\n                lastEditAt: phase74Now,\n              };\n            }\n          }\n        } catch (phase74Error) {\n          console.error(\"[PHASE74_TELEGRAM_LIVE_V2]\", phase74Error instanceof Error ? phase74Error.message : phase74Error);\n        }\n      }\n\n      const verdict = rule.verdict;`;

block = block.replace(anchor, insertion);
src = src.slice(0, fnStart) + block + src.slice(fnEnd);

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

const patchedBlock = src.slice(fnStart, fnStart + block.length + 5000);
const validationCalls = (patchedBlock.match(/validateDataServer\(symbol, metrics, session, null\)/g) || []).length;
const ruleCalls = (patchedBlock.match(/runRuleEngineServer\(symbol, metrics, validation, null\)/g) || []).length;
if (validationCalls !== 1 || ruleCalls !== 1) {
  throw new Error(`Phase74 P0: duplicate canonical decision call detected validation=${validationCalls} rule=${ruleCalls}`);
}

const insertedOnly = insertion.slice(anchor.indexOf("const rule") + 1);
for (const forbidden of ["placeOrder(", "executeTrade(", "refreshMarketSnapshot(", "app.get(", "app.post("]) {
  if (insertedOnly.includes(forbidden)) throw new Error(`Phase74 P0: forbidden behavior added: ${forbidden}`);
}

fs.writeFileSync(path, src);
console.log("Phase74 Telegram Live V2 patch applied safely");

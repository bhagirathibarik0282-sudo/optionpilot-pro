import test from "node:test";
import assert from "node:assert/strict";
import { resolveTelegramChatId } from "../telegram-sender-v2.js";

test("prefers Railway production chat-id names", () => {
  const env = {
    TELEGRAM_CHAT_ID_NIFTY: "nifty-current",
    TELEGRAM_NIFTY_CHAT_ID: "nifty-legacy",
    TELEGRAM_CHAT_ID_BANKNIFTY: "bank-current",
    TELEGRAM_CHAT_ID_SENSEX: "sensex-current",
  };
  assert.deepEqual(resolveTelegramChatId("NIFTY", env), { chatId: "nifty-current", envName: "TELEGRAM_CHAT_ID_NIFTY" });
  assert.deepEqual(resolveTelegramChatId("BANKNIFTY", env), { chatId: "bank-current", envName: "TELEGRAM_CHAT_ID_BANKNIFTY" });
  assert.deepEqual(resolveTelegramChatId("SENSEX", env), { chatId: "sensex-current", envName: "TELEGRAM_CHAT_ID_SENSEX" });
});

test("keeps legacy env names as fallback", () => {
  const env = { TELEGRAM_NIFTY_CHAT_ID: "legacy" };
  assert.deepEqual(resolveTelegramChatId("NIFTY", env), { chatId: "legacy", envName: "TELEGRAM_NIFTY_CHAT_ID" });
});

test("fails closed when no chat id is configured", () => {
  assert.throws(() => resolveTelegramChatId("NIFTY", {}), /TELEGRAM_CONFIG_MISSING/);
});

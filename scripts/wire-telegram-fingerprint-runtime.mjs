import fs from "node:fs";
import path from "node:path";

const file = path.resolve(process.cwd(), "server.ts");
const checkOnly = process.argv.includes("--check");
let src = fs.readFileSync(file, "utf8");
const original = src;

function replaceOnce(from, to, label) {
  const count = src.split(from).length - 1;
  if (count === 0 && src.includes(to)) return;
  if (count !== 1) throw new Error(`${label}: expected exactly 1 source occurrence, found ${count}`);
  src = src.replace(from, to);
}

replaceOnce(
  "const TELEGRAM_LAST_STRUCTURE_FINGERPRINT: Map<string, string> = new Map();",
  "const TELEGRAM_LAST_STRUCTURE_FINGERPRINT: Map<string, string> = new Map();\nconst TELEGRAM_LAST_STRUCTURE_BLOCK_FINGERPRINT: Map<string, string> = new Map();\nconst TELEGRAM_LAST_RISK_BLOCK_FINGERPRINT: Map<string, string> = new Map();\nconst TELEGRAM_LAST_CANDIDATE_FINGERPRINT: Map<string, string> = new Map();",
  "fingerprint map declarations",
);

replaceOnce(
  "TELEGRAM_LAST_STRUCTURE_FINGERPRINT.get(symbol) !== structureFingerprint",
  "TELEGRAM_LAST_STRUCTURE_BLOCK_FINGERPRINT.get(symbol) !== structureFingerprint",
  "structure blocker get",
);
replaceOnce(
  "TELEGRAM_LAST_STRUCTURE_FINGERPRINT.set(symbol, structureFingerprint);",
  "TELEGRAM_LAST_STRUCTURE_BLOCK_FINGERPRINT.set(symbol, structureFingerprint);",
  "structure blocker set",
);
replaceOnce(
  "TELEGRAM_LAST_STRUCTURE_FINGERPRINT.get(symbol) !== riskFingerprint",
  "TELEGRAM_LAST_RISK_BLOCK_FINGERPRINT.get(symbol) !== riskFingerprint",
  "risk blocker get",
);
replaceOnce(
  "TELEGRAM_LAST_STRUCTURE_FINGERPRINT.set(symbol, riskFingerprint);",
  "TELEGRAM_LAST_RISK_BLOCK_FINGERPRINT.set(symbol, riskFingerprint);",
  "risk blocker set",
);
replaceOnce(
  "TELEGRAM_LAST_STRUCTURE_FINGERPRINT.set(symbol, `${label}|${structure?.side || \"NONE\"}`);",
  "TELEGRAM_LAST_CANDIDATE_FINGERPRINT.set(symbol, `${label}|${structure?.side || \"NONE\"}`);",
  "candidate fingerprint set",
);
replaceOnce(
  "  TELEGRAM_LAST_STRUCTURE_FINGERPRINT.clear();",
  "  TELEGRAM_LAST_STRUCTURE_FINGERPRINT.clear();\n  TELEGRAM_LAST_STRUCTURE_BLOCK_FINGERPRINT.clear();\n  TELEGRAM_LAST_RISK_BLOCK_FINGERPRINT.clear();\n  TELEGRAM_LAST_CANDIDATE_FINGERPRINT.clear();",
  "daily fingerprint clear",
);

replaceOnce(
  "  const sendAlertSpaced = async (message: string, symbolForChat?: V2PremiumSymbol): Promise<void> => {\n    if (!alertIsFirstSend) await new Promise((resolve) => setTimeout(resolve, 1100));",
  "  const sendAlertSpaced = async (message: string, symbolForChat?: V2PremiumSymbol): Promise<void> => {\n    // Legacy structure/risk NO TRADE diagnostics remain internal only. Canonical meaningful Telegram owns user-facing transport.\n    if (message.includes(\"| NO TRADE</b>\") && message.includes(\"Manual review only.\")) return;\n    if (!alertIsFirstSend) await new Promise((resolve) => setTimeout(resolve, 1100));",
  "legacy no-trade transport suppression",
);

replaceOnce(
  "  for (const s of sessions.values()) {\n    if (s.expiresAt > Date.now()) { activeSession = s; break; }\n  }\n  if (!activeSession) return;\n\n  const symbols: V2PremiumSymbol[] = [\"NIFTY\", \"BANKNIFTY\", \"SENSEX\"];",
  "  for (const s of sessions.values()) {\n    if (s.expiresAt > Date.now()) { activeSession = s; break; }\n  }\n\n  // TELEGRAM_FAST_PERSISTED_AUTHORITY_FALLBACK_V1:\n  // Reuse the same encrypted Phase 62 read-only authority as the Recorder.\n  // The ephemeral session is never inserted into the browser session map.\n  if (!activeSession) {\n    const authority = phase62RestoredKiteAuthority ?? (await resolveKiteAuthoritySession()).session;\n    if (authority && authority.expiresAt > Date.now()) {\n      phase62RestoredKiteAuthority = authority;\n      activeSession = {\n        accessToken: authority.accessToken,\n        userId: authority.userId,\n        email: authority.email ?? \"\",\n        loginTime: authority.loginTime,\n        expiresAt: authority.expiresAt,\n      };\n    }\n  }\n  if (!activeSession) return;\n\n  const symbols: V2PremiumSymbol[] = [\"NIFTY\", \"BANKNIFTY\", \"SENSEX\"];",
  "Telegram fast persisted authority fallback",
);

if (checkOnly) {
  if (src === original) {
    console.log("telegram fingerprint runtime wiring already applied");
  } else {
    console.log("telegram fingerprint runtime wiring check passed");
  }
  process.exit(0);
}

if (src !== original) {
  fs.writeFileSync(file, src, "utf8");
  console.log("telegram fingerprint runtime wiring applied");
} else {
  console.log("telegram fingerprint runtime wiring already applied");
}

import { readFileSync, writeFileSync } from "node:fs";

const path = "server.ts";
let source = readFileSync(path, "utf8");

function replaceOnce(label, needle, replacement) {
  const first = source.indexOf(needle);
  if (first < 0) throw new Error(`PHASE62_ANCHOR_MISSING:${label}`);
  if (source.indexOf(needle, first + needle.length) >= 0) {
    throw new Error(`PHASE62_ANCHOR_AMBIGUOUS:${label}`);
  }
  source = source.slice(0, first) + replacement + source.slice(first + needle.length);
}

function insertBeforeOnce(label, anchor, insertion) {
  replaceOnce(label, anchor, insertion + anchor);
}

if (source.includes("PHASE62_KITE_RUNTIME_WIRING_V1")) {
  console.log("PHASE62_ALREADY_WIRED");
  process.exit(0);
}

const dbImport = 'import { dbInit, dbInsert, dbLoadRecent, dbIsConfigured } from "./db.js";';
replaceOnce(
  "AUTHORITY_IMPORT",
  dbImport,
  `${dbImport}\nimport { persistKiteAuthoritySession, resolveKiteAuthoritySession, getKiteAuthorityPublicStatus, kiteSessionIdMatchesFingerprint, type KiteAuthorityResolvedSession } from "./kite-session-authority.js";\nimport { revokeKiteAuthoritySession } from "./kite-session-authority-revoke.js";`,
);

const sessionsAnchor = "const sessions = new Map<string, KiteSession>();";
replaceOnce(
  "RUNTIME_CACHE",
  sessionsAnchor,
  `${sessionsAnchor}\n\n// PHASE62_KITE_RUNTIME_WIRING_V1 — restart-safe authority cache only.\n// It never changes score/verdict/Telegram/execution and never exposes credentials.\nlet phase62RestoredKiteAuthority: KiteAuthorityResolvedSession | null = null;\n\nasync function refreshPhase62KiteAuthorityCache(): Promise<void> {\n  try {\n    const resolved = await resolveKiteAuthoritySession();\n    phase62RestoredKiteAuthority = resolved.session;\n    console.log(\`[PHASE62][KITE_AUTHORITY] status=\${resolved.status.code}\`);\n  } catch (err) {\n    phase62RestoredKiteAuthority = null;\n    console.warn(\"[PHASE62][KITE_AUTHORITY] restore failed closed:\", err instanceof Error ? err.message : String(err));\n  }\n}\n\nvoid refreshPhase62KiteAuthorityCache();`,
);

replaceOnce(
  "GET_SESSION_LOOKUP",
  "    const session = sessions.get(sessionId);",
  `    let session = sessions.get(sessionId);\n    if (!session && phase62RestoredKiteAuthority && kiteSessionIdMatchesFingerprint(sessionId, phase62RestoredKiteAuthority.sessionIdFingerprint)) {\n      session = {\n        accessToken: phase62RestoredKiteAuthority.accessToken,\n        userId: phase62RestoredKiteAuthority.userId,\n        email: phase62RestoredKiteAuthority.email ?? \"\",\n        loginTime: phase62RestoredKiteAuthority.loginTime,\n        expiresAt: phase62RestoredKiteAuthority.expiresAt,\n      };\n      sessions.set(sessionId, session);\n      console.log(\"[PHASE62][KITE_AUTHORITY] restored in-memory session from shared authority\");\n    }`,
);

replaceOnce(
  "CALLBACK_LOGIN_TIME",
  "    const expiresAt = nextKiteExpiryTime();\n    sessions.set(sessionId, {",
  "    const expiresAt = nextKiteExpiryTime();\n    const loginTime = Date.now();\n    sessions.set(sessionId, {",
);

replaceOnce(
  "CALLBACK_LOGIN_TIME_VALUE",
  "      loginTime: Date.now(),",
  "      loginTime,",
);

insertBeforeOnce(
  "CALLBACK_PERSIST",
  "    // Store session ID in secure HTTP-only cookie",
  `    // Phase 62: persist encrypted shared authority. Failure does not break the current live login;\n    // it only disables restart restoration and is reported fail-closed.\n    const authorityPersist = await persistKiteAuthoritySession({\n      accessToken: tokenData.accessToken,\n      sessionId,\n      userId: tokenData.userId,\n      email: tokenData.email,\n      loginTime,\n      expiresAt,\n    });\n    if (authorityPersist.ok) {\n      await refreshPhase62KiteAuthorityCache();\n    } else {\n      phase62RestoredKiteAuthority = null;\n      console.warn(\`[PHASE62][KITE_AUTHORITY] persistence unavailable status=\${authorityPersist.status.code}\`);\n    }\n\n`,
);

replaceOnce(
  "LOGOUT_ASYNC",
  'app.post("/api/kite/logout", (c) => {',
  'app.post("/api/kite/logout", async (c) => {',
);

insertBeforeOnce(
  "LOGOUT_REVOKE",
  '  c.header(\n    "Set-Cookie",\n    "session_id=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0"',
  `  const revokeResult = await revokeKiteAuthoritySession();\n  phase62RestoredKiteAuthority = null;\n  if (!revokeResult.ok) {\n    console.warn(\`[PHASE62][KITE_AUTHORITY] logout authority revoke status=\${revokeResult.code}\`);\n  }\n`,
);

insertBeforeOnce(
  "PUBLIC_STATUS_ROUTE",
  "// Kite Status - Returns connection status and user info (NEVER exposes tokens)",
  `// Phase 62 read-only authority health. Never returns token or browser session id.\napp.get(\"/api/system/kite-session-authority\", async (c) => {\n  return c.json(await getKiteAuthorityPublicStatus());\n});\n\n`,
);

writeFileSync(path, source);
console.log("PHASE62_RUNTIME_WIRING_APPLIED");

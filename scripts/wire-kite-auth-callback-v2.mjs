import fs from "node:fs";
import path from "node:path";

const file = path.resolve(process.cwd(), "server.ts");
const checkOnly = process.argv.includes("--check");
const MARKER = "OPTIONPILOT_KITE_AUTH_CALLBACK_V2";
const HANDOFF_MARKER = "OPTIONPILOT_KITE_LOGIN_HANDOFF_PAGE_V1";

let src = fs.readFileSync(file, "utf8");
const original = src;

const oldLogin = '  return `https://kite.trade/connect/login?api_key=${KITE_API_KEY}&v=3`;';
const newLogin = `  // ${MARKER}: use Zerodha's canonical Kite Connect v3 login endpoint.\n  return \`https://kite.zerodha.com/connect/login?v=3&api_key=\${encodeURIComponent(KITE_API_KEY)}\`;`;

const oldCallback = `    const requestToken = c.req.query("request_token");\n    const status = c.req.query("status");\n\n    console.log(\`[AUTH] Callback received with status=\${status}\`);\n\n    if (status !== "success" || !requestToken) {\n      console.warn("[AUTH] Invalid callback: missing status or token");\n      return c.redirect("/?login_error=true&error=Invalid+request");\n    }`;

const newCallback = `    // ${MARKER}: request_token is the required Kite handoff. Some valid redirects may omit status.\n    // Never log the token value; diagnostics expose only presence and query-key names.\n    const callbackUrl = new URL(c.req.url);\n    const requestToken = c.req.query("request_token") ?? callbackUrl.searchParams.get("request_token") ?? undefined;\n    const status = c.req.query("status") ?? callbackUrl.searchParams.get("status") ?? undefined;\n    const callbackQueryKeys = Array.from(new Set(callbackUrl.searchParams.keys())).sort();\n    const callbackKeySummary = callbackQueryKeys.join(",") || "none";\n\n    console.log(\`[AUTH] Callback received status=\${status ?? "missing"} requestTokenPresent=\${Boolean(requestToken)} queryKeys=\${callbackKeySummary}\`);\n\n    if (!requestToken || (status !== undefined && status !== "success")) {\n      console.warn(\`[AUTH] Invalid callback requestTokenPresent=\${Boolean(requestToken)} status=\${status ?? "missing"} queryKeys=\${callbackKeySummary}\`);\n      return c.redirect("/?login_error=true&error=Invalid+request");\n    }`;

const oldLoginHandler = `  const loginUrl = getKiteLoginUrl();\n  console.log("[AUTH] Redirecting to Kite login");\n  return c.redirect(loginUrl);`;

const newLoginHandler = `  const loginUrl = getKiteLoginUrl();\n  // ${HANDOFF_MARKER}: render a same-origin handoff page instead of relying on an automatic cross-site 302.\n  // The API secret and access token are never included in the page.\n  const safeLoginUrl = loginUrl.replace(/&/g, "&amp;").replace(/\"/g, "&quot;");\n  console.log("[AUTH] Rendering Kite login handoff page");\n  return c.html(\`<!doctype html>\n<html lang="en">\n<head>\n  <meta charset="utf-8" />\n  <meta name="viewport" content="width=device-width,initial-scale=1" />\n  <title>OptionPilot Pro — Kite Login</title>\n  <style>\n    body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#0b1020;color:#eef2ff;display:grid;place-items:center;min-height:100vh;margin:0;padding:24px;box-sizing:border-box}\n    .card{max-width:520px;width:100%;background:#121a2f;border:1px solid #2b3a67;border-radius:18px;padding:28px;box-sizing:border-box;box-shadow:0 18px 55px rgba(0,0,0,.35)}\n    h1{font-size:22px;margin:0 0 10px}.muted{color:#a9b4d0;line-height:1.5;margin:0 0 22px}\n    a{display:block;text-align:center;background:#5b7cff;color:white;text-decoration:none;font-weight:700;padding:15px 18px;border-radius:12px}\n    .note{font-size:13px;color:#8e9ab8;margin-top:16px;line-height:1.45}\n  </style>\n</head>\n<body>\n  <main class="card">\n    <h1>OptionPilot Pro — Kite Login</h1>\n    <p class="muted">Tap the button below to open the official Zerodha Kite Connect login page.</p>\n    <a href="\${safeLoginUrl}">Open Zerodha Kite Login</a>\n    <p class="note">After successful login, Zerodha will return you to OptionPilot automatically. No API secret or access token is shown on this page.</p>\n  </main>\n</body>\n</html>\`);`;

function replaceExactlyOnce(label, from, to) {
  if (src.includes(to)) return;
  const count = src.split(from).length - 1;
  if (count !== 1) throw new Error(`${label}_ANCHOR_COUNT_${count}`);
  src = src.replace(from, to);
}

if (!src.includes(MARKER)) {
  replaceExactlyOnce("KITE_LOGIN_URL", oldLogin, newLogin);
  replaceExactlyOnce("KITE_CALLBACK", oldCallback, newCallback);
}
if (!src.includes(HANDOFF_MARKER)) {
  replaceExactlyOnce("KITE_LOGIN_HANDLER", oldLoginHandler, newLoginHandler);
}

if (!src.includes("https://kite.zerodha.com/connect/login?v=3&api_key=")) {
  throw new Error("KITE_CANONICAL_LOGIN_URL_NOT_WIRED");
}
if (!src.includes("requestTokenPresent=${Boolean(requestToken)}")) {
  throw new Error("KITE_SAFE_CALLBACK_DIAGNOSTICS_NOT_WIRED");
}
if (!src.includes('if (!requestToken || (status !== undefined && status !== "success"))')) {
  throw new Error("KITE_REQUEST_TOKEN_AUTHORITY_RULE_NOT_WIRED");
}
if (!src.includes(HANDOFF_MARKER) || !src.includes("Open Zerodha Kite Login")) {
  throw new Error("KITE_LOGIN_HANDOFF_PAGE_NOT_WIRED");
}
if (src.includes("return c.redirect(loginUrl);")) {
  throw new Error("KITE_AUTOMATIC_LOGIN_REDIRECT_STILL_PRESENT");
}

if (checkOnly) {
  console.log("kite auth callback v2 wiring check PASS");
} else if (src !== original) {
  fs.writeFileSync(file, src, "utf8");
  console.log("kite auth callback v2 wiring applied");
} else {
  console.log("kite auth callback v2 wiring already applied");
}

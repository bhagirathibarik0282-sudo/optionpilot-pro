import fs from "node:fs";
import path from "node:path";

const file = path.resolve(process.cwd(), "server.ts");
const checkOnly = process.argv.includes("--check");
const MARKER = "OPTIONPILOT_KITE_AUTH_CALLBACK_V2";

let src = fs.readFileSync(file, "utf8");
const original = src;

const oldLogin = '  return `https://kite.trade/connect/login?api_key=${KITE_API_KEY}&v=3`;';
const newLogin = `  // ${MARKER}: use Zerodha's canonical Kite Connect v3 login endpoint.\n  return \`https://kite.zerodha.com/connect/login?v=3&api_key=\${encodeURIComponent(KITE_API_KEY)}\`;`;

const oldCallback = `    const requestToken = c.req.query("request_token");\n    const status = c.req.query("status");\n\n    console.log(\`[AUTH] Callback received with status=\${status}\`);\n\n    if (status !== "success" || !requestToken) {\n      console.warn("[AUTH] Invalid callback: missing status or token");\n      return c.redirect("/?login_error=true&error=Invalid+request");\n    }`;

const newCallback = `    // ${MARKER}: request_token is the required Kite handoff. Some valid redirects may omit status.\n    // Never log the token value; diagnostics expose only presence and query-key names.\n    const callbackUrl = new URL(c.req.url);\n    const requestToken = c.req.query("request_token") ?? callbackUrl.searchParams.get("request_token") ?? undefined;\n    const status = c.req.query("status") ?? callbackUrl.searchParams.get("status") ?? undefined;\n    const callbackQueryKeys = Array.from(new Set(callbackUrl.searchParams.keys())).sort();\n    const callbackKeySummary = callbackQueryKeys.join(",") || "none";\n\n    console.log(\`[AUTH] Callback received status=\${status ?? "missing"} requestTokenPresent=\${Boolean(requestToken)} queryKeys=\${callbackKeySummary}\`);\n\n    if (!requestToken || (status !== undefined && status !== "success")) {\n      console.warn(\`[AUTH] Invalid callback requestTokenPresent=\${Boolean(requestToken)} status=\${status ?? "missing"} queryKeys=\${callbackKeySummary}\`);\n      return c.redirect("/?login_error=true&error=Invalid+request");\n    }`;

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

if (!src.includes("https://kite.zerodha.com/connect/login?v=3&api_key=")) {
  throw new Error("KITE_CANONICAL_LOGIN_URL_NOT_WIRED");
}
if (!src.includes("requestTokenPresent=${Boolean(requestToken)}")) {
  throw new Error("KITE_SAFE_CALLBACK_DIAGNOSTICS_NOT_WIRED");
}
if (!src.includes('if (!requestToken || (status !== undefined && status !== "success"))')) {
  throw new Error("KITE_REQUEST_TOKEN_AUTHORITY_RULE_NOT_WIRED");
}

if (checkOnly) {
  console.log("kite auth callback v2 wiring check PASS");
} else if (src !== original) {
  fs.writeFileSync(file, src, "utf8");
  console.log("kite auth callback v2 wiring applied");
} else {
  console.log("kite auth callback v2 wiring already applied");
}

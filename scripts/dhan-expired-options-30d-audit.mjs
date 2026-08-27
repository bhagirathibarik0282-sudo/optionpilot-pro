import { createHmac } from "node:crypto";

const clientId = (process.env.DHAN_CLIENT_ID || "").trim();
const legacyToken = (process.env.DHAN_ACCESS_TOKEN || "").trim();
const pin = (process.env.DHAN_PIN || "").trim();
const totpSecret = (process.env.DHAN_TOTP_SECRET || "").trim();

function base32Decode(input) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = input.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = "";
  for (const ch of clean) {
    const v = alphabet.indexOf(ch);
    if (v >= 0) bits += v.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

function generateTotp(secret, stepSeconds = 30, digits = 6) {
  const key = base32Decode(secret);
  const counter = Math.floor(Date.now() / 1000 / stepSeconds);
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", key).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const bin = ((hmac[offset] & 0x7f) << 24) | ((hmac[offset + 1] & 0xff) << 16) | ((hmac[offset + 2] & 0xff) << 8) | (hmac[offset + 3] & 0xff);
  return (bin % 10 ** digits).toString().padStart(digits, "0");
}

async function getAccessToken() {
  if (clientId && pin && totpSecret) {
    const totp = generateTotp(totpSecret);
    const params = new URLSearchParams({ dhanClientId: clientId, pin, totp });
    const res = await fetch(`https://auth.dhan.co/app/generateAccessToken?${params.toString()}`, { method: "POST" });
    const json = await res.json().catch(() => null);
    if (res.ok && json?.accessToken) {
      console.log(JSON.stringify({ dhanAuth: "TOTP_REFRESH_OK", expiryTime: json.expiryTime || null, tokenExposed: false }));
      return json.accessToken;
    }
    console.error(JSON.stringify({ dhanAuth: "TOTP_REFRESH_FAIL", httpStatus: res.status, error: json?.errorMessage || null, tokenExposed: false }));
  }
  return legacyToken || null;
}

const accessToken = await getAccessToken();
if (!accessToken || !clientId) {
  console.error(JSON.stringify({ ok: false, error: "No valid Dhan access token/client id", tokenExposed: false }, null, 2));
  process.exit(1);
}

const symbol = (process.env.DHAN_SYMBOL || "NIFTY").toUpperCase();
const overallFrom = process.env.DHAN_FROM_DATE || "2026-07-02";
const overallTo = process.env.DHAN_TO_DATE || "2026-08-01";
const chunkDays = 7;
const underlyingMap = {
  NIFTY: { securityId: 13, exchangeSegment: "NSE_FNO" },
  BANKNIFTY: { securityId: 25, exchangeSegment: "NSE_FNO" },
  SENSEX: { securityId: 51, exchangeSegment: "BSE_FNO" },
};
const mapping = underlyingMap[symbol];
if (!mapping) process.exit(1);

const sides = ["CALL", "PUT"];
const results = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmt = (d) => d.toISOString().slice(0, 10);

let cursor = new Date(`${overallFrom}T00:00:00Z`);
const end = new Date(`${overallTo}T00:00:00Z`);
const chunks = [];
while (cursor < end) {
  const next = new Date(Math.min(end.getTime(), cursor.getTime() + chunkDays * 86400000));
  chunks.push({ fromDate: fmt(cursor), toDate: fmt(next) });
  cursor = next;
}

for (const chunk of chunks) {
  for (const side of sides) {
    const body = {
      exchangeSegment: mapping.exchangeSegment,
      interval: "1",
      securityId: mapping.securityId,
      instrument: "OPTIDX",
      expiryFlag: "WEEK",
      expiryCode: 1,
      strike: "ATM",
      drvOptionType: side,
      requiredData: ["open", "high", "low", "close", "iv", "volume", "strike", "oi", "spot"],
      fromDate: chunk.fromDate,
      toDate: chunk.toDate,
    };
    try {
      const res = await fetch("https://api.dhan.co/v2/charts/rollingoption", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json", "access-token": accessToken, "client-id": clientId },
        body: JSON.stringify(body),
      });
      const raw = await res.text();
      let payload = null;
      try { payload = raw ? JSON.parse(raw) : null; } catch {}
      const node = side === "CALL" ? payload?.data?.ce : payload?.data?.pe;
      const timestamp = Array.isArray(node?.timestamp) ? node.timestamp : [];
      const fields = ["open", "high", "low", "close", "iv", "volume", "strike", "oi", "spot", "timestamp"];
      const fieldAudit = {};
      for (const field of fields) {
        const v = node?.[field];
        fieldAudit[field] = { present: Array.isArray(v), count: Array.isArray(v) ? v.length : 0 };
      }
      results.push({ ...chunk, strike: "ATM", side, httpStatus: res.status, ok: res.ok && Boolean(node) && timestamp.length > 0, candleCount: timestamp.length, fieldAudit, providerError: !res.ok || !node ? { errorCode: payload?.errorCode ?? null, errorMessage: payload?.errorMessage ?? null, rawSnippet: raw.slice(0, 220) } : null });
    } catch (err) {
      results.push({ ...chunk, strike: "ATM", side, ok: false, candleCount: 0, error: err instanceof Error ? err.message : String(err) });
    }
    await sleep(700);
  }
}

const passed = results.filter((r) => r.ok).length;
console.log(JSON.stringify({
  architectureRole: "DHAN_EXPIRED_OPTIONS_7D_CHUNK_AUDIT_V3",
  generatedAt: new Date().toISOString(),
  readOnlyMode: true,
  orderAccessUsed: false,
  tokenExposed: false,
  symbol,
  overallWindow: { fromDate: overallFrom, toDate: overallTo, toDateNonInclusive: true },
  chunkDays,
  chunks: chunks.length,
  testScope: "ATM only, CALL+PUT",
  totalRequests: results.length,
  passed,
  failed: results.length - passed,
  status: passed === results.length ? "PASS" : passed > 0 ? "PARTIAL" : "FAIL",
  safeFor30DayATM: passed === results.length,
  results,
}, null, 2));
if (passed === 0) process.exitCode = 2;

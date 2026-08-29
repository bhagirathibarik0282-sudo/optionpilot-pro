export interface NseFiiDiiRow {
  category?: string;
  date?: string;
  buyValue?: string | number;
  sellValue?: string | number;
  netValue?: string | number;
  [key: string]: unknown;
}

export interface NormalizedFiiDiiCash {
  date: string;
  source: "NSE_FII_DII";
  sourceUrl: string;
  fetchedAt: string;
  fii: { buy: number; sell: number; net: number };
  dii: { buy: number; sell: number; net: number };
}

export const NSE_FII_DII_URL = "https://www.nseindia.com/api/fiidiiTradeReact";

function finiteNumber(value: unknown, label: string): number {
  const n = typeof value === "number" ? value : Number(String(value ?? "").replace(/,/g, "").trim());
  if (!Number.isFinite(n)) throw new Error(`INVALID_${label}`);
  return n;
}

export function normalizeNseDate(value: unknown): string {
  const raw = String(value ?? "").trim();
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return raw;
  const dmy = raw.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
  const slash = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (slash) return `${slash[3]}-${slash[2]}-${slash[1]}`;
  throw new Error("INVALID_NSE_FII_DII_DATE");
}

function categoryOf(row: NseFiiDiiRow): string {
  return String(row.category ?? row.Category ?? row.clientType ?? row.clienttype ?? "").toUpperCase();
}

function rowDate(row: NseFiiDiiRow): string {
  return normalizeNseDate(row.date ?? row.Date ?? row.tradeDate ?? row.tradedate);
}

function value(row: NseFiiDiiRow, names: string[], label: string): number {
  for (const name of names) {
    if (row[name] !== undefined && row[name] !== null && String(row[name]).trim() !== "") return finiteNumber(row[name], label);
  }
  throw new Error(`MISSING_${label}`);
}

export function parseNseFiiDiiResponse(rows: unknown, fetchedAt = new Date().toISOString()): NormalizedFiiDiiCash {
  if (!Array.isArray(rows) || rows.length === 0) throw new Error("EMPTY_NSE_FII_DII_RESPONSE");
  const typed = rows as NseFiiDiiRow[];
  const fii = typed.find((r) => /FII|FPI/.test(categoryOf(r)));
  const dii = typed.find((r) => /DII/.test(categoryOf(r)));
  if (!fii) throw new Error("NSE_FII_ROW_MISSING");
  if (!dii) throw new Error("NSE_DII_ROW_MISSING");
  const fiiDate = rowDate(fii);
  const diiDate = rowDate(dii);
  if (fiiDate !== diiDate) throw new Error("NSE_FII_DII_DATE_MISMATCH");

  const fiiBuy = value(fii, ["buyValue", "buyvalue", "buy", "Buy Value", "buy_value"], "FII_BUY");
  const fiiSell = value(fii, ["sellValue", "sellvalue", "sell", "Sell Value", "sell_value"], "FII_SELL");
  const diiBuy = value(dii, ["buyValue", "buyvalue", "buy", "Buy Value", "buy_value"], "DII_BUY");
  const diiSell = value(dii, ["sellValue", "sellvalue", "sell", "Sell Value", "sell_value"], "DII_SELL");

  return {
    date: fiiDate,
    source: "NSE_FII_DII",
    sourceUrl: NSE_FII_DII_URL,
    fetchedAt,
    fii: { buy: fiiBuy, sell: fiiSell, net: fiiBuy - fiiSell },
    dii: { buy: diiBuy, sell: diiSell, net: diiBuy - diiSell },
  };
}

export async function fetchNseFiiDii(fetchImpl: typeof fetch = fetch): Promise<NormalizedFiiDiiCash> {
  const response = await fetchImpl(NSE_FII_DII_URL, {
    headers: {
      accept: "application/json,text/plain,*/*",
      "accept-language": "en-US,en;q=0.9",
      referer: "https://www.nseindia.com/reports/fii-dii",
      "user-agent": "Mozilla/5.0",
    },
  });
  if (!response.ok) throw new Error(`NSE_FII_DII_HTTP_${response.status}`);
  return parseNseFiiDiiResponse(await response.json());
}

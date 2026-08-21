// ============================================================================
// FII/DII Drive auto-import parser (2026-08-21).
//
// Purpose: parse the plain "Label: value" text format the dashboard's
// manual FII/DII paste box already accepts, server-side, so the Drive
// auto-importer can parse a file without a browser.
//
// HARD RULES (mirrors outcome-engine.ts's isolation discipline):
//   - Pure and self-contained. No import from server.ts, no wall-clock
//     access (no Date.now()/new Date() defaults baked in) — if the pasted
//     text doesn't carry a "Date:" line, `date` comes back null and the
//     CALLER (server.ts) decides the fallback (e.g. indiaDate()). This
//     keeps the module trivially unit-testable in isolation.
//   - Never fabricates a "recognized" entry from unrelated text — requires
//     at least one of the two cash figures to be present before returning
//     anything other than null.
// ============================================================================

export interface ParsedFiiDiiDerivative {
  category: string;
  oiChange: number;
  bias: "Long Buildup" | "Short Buildup" | "Long Unwinding" | "Short Covering";
}

export interface ParsedFiiDiiEntry {
  date: string | null; // null if the pasted text had no "Date:" line
  fiiCashCr: number;
  diiCashCr: number;
  derivatives: ParsedFiiDiiDerivative[];
}

// Mirrors the client-side FII_DII_PASTE_LABEL_MAP in server.ts's dashboard
// JS (parseFiiDiiPaste()) — kept in sync by hand since one is browser JS
// and the other is this server-side TS module.
export const FII_DII_PASTE_LABEL_MAP: Record<string, string> = {
  Date: "date",
  "FII Cash": "fiiCashCr",
  "DII Cash": "diiCashCr",
  "Index Futures OI": "deriv0Val",
  "Index Futures Bias": "deriv0Bias",
  "Stock Futures OI": "deriv1Val",
  "Stock Futures Bias": "deriv1Bias",
  "Index Options Call OI": "deriv2Val",
  "Index Options Call Bias": "deriv2Bias",
  "Index Options Put OI": "deriv3Val",
  "Index Options Put Bias": "deriv3Bias",
};

export const FII_DII_DERIVATIVE_CATEGORIES = ["Index Futures", "Stock Futures", "Index Options (Call)", "Index Options (Put)"];

export function normalizeFiiDiiBias(raw: string | undefined): ParsedFiiDiiDerivative["bias"] | null {
  if (!raw) return null;
  const v = raw.trim().toLowerCase();
  if (v === "long" || v === "long buildup") return "Long Buildup";
  if (v === "short" || v === "short buildup") return "Short Buildup";
  if (v === "long unwinding") return "Long Unwinding";
  if (v === "short covering") return "Short Covering";
  return null;
}

// Pure function — mirrors parseFiiDiiPaste()'s label-map parsing
// (client-side, dashboard-only) but server-side so the Drive importer
// doesn't need a browser. Unit-tested directly.
export function parseFiiDiiPasteServerSide(text: string): ParsedFiiDiiEntry | null {
  const fields: Record<string, string> = {};
  const lines = (text || "").split("\n");
  for (const line of lines) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const label = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    const fieldId = FII_DII_PASTE_LABEL_MAP[label];
    if (!fieldId) continue;
    fields[fieldId] = value;
  }

  // A recognizable entry needs at least one of the two cash figures --
  // anything less isn't confidently "FII/DII data", so don't fabricate a
  // partial entry from stray matched lines (e.g. a file that only
  // happened to contain an unrelated "Date: ..." line).
  if (fields.fiiCashCr === undefined && fields.diiCashCr === undefined) return null;

  const derivatives: ParsedFiiDiiDerivative[] = FII_DII_DERIVATIVE_CATEGORIES.map((cat, i) => ({
    category: cat,
    oiChange: Number(fields[`deriv${i}Val`]) || 0,
    bias: normalizeFiiDiiBias(fields[`deriv${i}Bias`]) || "Long Buildup",
  }));

  return {
    date: fields.date || null,
    fiiCashCr: Number(fields.fiiCashCr) || 0,
    diiCashCr: Number(fields.diiCashCr) || 0,
    derivatives,
  };
}

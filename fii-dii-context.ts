import { dbQuerySafe } from "./db.js";

export type InstitutionalFlowBias = "RISK_ON" | "RISK_OFF" | "ABSORPTION" | "MIXED" | "UNAVAILABLE";

export interface FiiDiiContextWindow {
  sessions: 1 | 3 | 5 | 20;
  availableSessions: number;
  fiiNet: number | null;
  diiNet: number | null;
  combinedNet: number | null;
  bias: InstitutionalFlowBias;
}

export interface FiiDiiContextSnapshot {
  latestTradeDate: string | null;
  windows: FiiDiiContextWindow[];
  freshness: "CURRENT_SESSION" | "PRIOR_SESSION" | "STALE" | "UNAVAILABLE";
  reasons: string[];
  ruleVersion: "FII_DII_CONTEXT_V1";
  semantics: "CONTEXT_ONLY";
  affectsVerdict: false;
  affectsTelegram: false;
  affectsExecution: false;
}

type FlowRow = {
  trade_date: string | Date;
  fii_net: number | null;
  dii_net: number | null;
};

function finite(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function sumFinite(rows: FlowRow[], key: "fii_net" | "dii_net"): number | null {
  const values = rows.map((r) => r[key]).filter(finite);
  if (!values.length) return null;
  return values.reduce((a, b) => a + b, 0);
}

function classify(fiiNet: number | null, diiNet: number | null): InstitutionalFlowBias {
  if (fiiNet == null || diiNet == null) return "UNAVAILABLE";
  if (fiiNet > 0 && diiNet >= 0) return "RISK_ON";
  if (fiiNet < 0 && diiNet <= 0) return "RISK_OFF";
  if (fiiNet < 0 && diiNet > 0 && diiNet >= Math.abs(fiiNet) * 0.5) return "ABSORPTION";
  return "MIXED";
}

function dateOnly(v: string | Date): string {
  return new Date(v).toISOString().slice(0, 10);
}

function daysBetween(a: string, b: string): number {
  const ms = Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

function freshnessFrom(latestTradeDate: string | null, marketSessionDate: string | null): FiiDiiContextSnapshot["freshness"] {
  if (!latestTradeDate || !marketSessionDate) return "UNAVAILABLE";
  const lag = daysBetween(marketSessionDate, latestTradeDate);
  if (lag <= 0) return "CURRENT_SESSION";
  if (lag <= 3) return "PRIOR_SESSION";
  return "STALE";
}

export async function deriveFiiDiiContext(): Promise<FiiDiiContextSnapshot> {
  const [flowQ, marketQ] = await Promise.all([
    dbQuerySafe<FlowRow>(`
      SELECT trade_date, fii_net, dii_net
      FROM fii_dii_cash_daily
      ORDER BY trade_date DESC
      LIMIT 20
    `),
    dbQuerySafe<{ trade_date: string | null }>(`
      SELECT MAX((minute_bucket AT TIME ZONE 'Asia/Kolkata')::date)::text AS trade_date
      FROM market_snapshot_1m
    `),
  ]);

  const rows = flowQ?.rows ?? [];
  const latestTradeDate = rows[0] ? dateOnly(rows[0].trade_date) : null;
  const marketSessionDate = marketQ?.rows?.[0]?.trade_date?.trim() || null;
  const windows = ([1, 3, 5, 20] as const).map((sessions) => {
    const slice = rows.slice(0, sessions);
    const fiiNet = sumFinite(slice, "fii_net");
    const diiNet = sumFinite(slice, "dii_net");
    return {
      sessions,
      availableSessions: slice.length,
      fiiNet,
      diiNet,
      combinedNet: fiiNet == null || diiNet == null ? null : fiiNet + diiNet,
      bias: classify(fiiNet, diiNet),
    };
  });

  const freshness = freshnessFrom(latestTradeDate, marketSessionDate);
  const reasons: string[] = [];
  if (!rows.length) reasons.push("No stored FII/DII cash sessions are available.");
  if (freshness === "PRIOR_SESSION") reasons.push("Institutional cash context is from the latest available prior session; it must not be treated as an intraday trigger.");
  if (freshness === "STALE") reasons.push("Institutional cash context is stale and should be displayed only as low-confidence background context.");
  if (rows.length < 20) reasons.push(`Only ${rows.length} stored sessions are available; longer-window context is partial.`);
  if (!reasons.length) reasons.push("Stored institutional cash context is available for background/regime interpretation only.");

  return {
    latestTradeDate,
    windows,
    freshness,
    reasons,
    ruleVersion: "FII_DII_CONTEXT_V1",
    semantics: "CONTEXT_ONLY",
    affectsVerdict: false,
    affectsTelegram: false,
    affectsExecution: false,
  };
}

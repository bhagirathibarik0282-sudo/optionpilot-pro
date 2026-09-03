import { dbQuerySafe } from "./db.js";
import { runH1ReplayHttp, type H1ReplayRequest } from "./h1-replay-http.js";

export type ReplayDirection = "UP" | "DOWN" | "FLAT" | "UNAVAILABLE";

export interface ReplayWindowEvidence {
  windowMinutes: 3 | 6 | 15 | 30;
  sampleCount: number;
  start: string | null;
  end: string | null;
  open: number | null;
  close: number | null;
  returnPct: number | null;
  direction: ReplayDirection;
}

export interface ReplayInstitutionalWindow {
  sessions: 1 | 3 | 5 | 20;
  availableSessions: number;
  fiiNet: number | null;
  diiNet: number | null;
  combinedNet: number | null;
}

export interface H1ReplayIntelligenceResult {
  ok: boolean;
  mode: "READ_ONLY_H1_REPLAY_INTELLIGENCE_V1";
  productionImpact: "NONE";
  request: H1ReplayRequest;
  asOf: string;
  temporal?: {
    clue3m: ReplayWindowEvidence;
    confirm6m: ReplayWindowEvidence;
    validate15m: ReplayWindowEvidence;
    sustain30m: ReplayWindowEvidence;
  };
  institutionalContext?: {
    latestAvailableTradeDate: string | null;
    windows: ReplayInstitutionalWindow[];
    semantics: "AS_OF_DATE_CONTEXT_ONLY";
  };
  latestChain?: Record<string, unknown>[];
  latestOptions?: Record<string, unknown>[];
  blockers: string[];
  antiLeakage: {
    noRowsAfterRequestedToTime: boolean;
    noInstitutionalRowsAfterTradeDate: boolean;
  };
  affectsVerdict: false;
  affectsTelegram: false;
  affectsExecution: false;
  aiMayOverride: false;
  reason?: string;
}

type FlowRow = { trade_date: string | Date; fii_net: number | null; dii_net: number | null };

function finite(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function iso(v: unknown): string | null {
  if (typeof v !== "string" && !(v instanceof Date)) return null;
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

function summarizeWindow(rows: Record<string, unknown>[], minutes: 3 | 6 | 15 | 30): ReplayWindowEvidence {
  const slice = rows.slice(-minutes);
  const first = slice[0] ?? null;
  const last = slice[slice.length - 1] ?? null;
  const open = finite(first?.spot_ltp);
  const close = finite(last?.spot_ltp);
  const returnPct = open == null || close == null || open === 0 ? null : ((close - open) / Math.abs(open)) * 100;
  const direction: ReplayDirection = returnPct == null ? "UNAVAILABLE" : returnPct > 0.02 ? "UP" : returnPct < -0.02 ? "DOWN" : "FLAT";
  return {
    windowMinutes: minutes,
    sampleCount: slice.length,
    start: iso(first?.minute_bucket),
    end: iso(last?.minute_bucket),
    open,
    close,
    returnPct,
    direction,
  };
}

function sum(rows: FlowRow[], key: "fii_net" | "dii_net"): number | null {
  const values = rows.map((r) => r[key]).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  return values.length ? values.reduce((a, b) => a + b, 0) : null;
}

function dateOnly(v: string | Date): string {
  return new Date(v).toISOString().slice(0, 10);
}

export async function runH1ReplayIntelligenceHttp(request: H1ReplayRequest): Promise<H1ReplayIntelligenceResult> {
  const replay = await runH1ReplayHttp(request);
  const asOf = `${request.tradeDate}T${request.toTime}:00+05:30`;
  if (!replay.ok) {
    return {
      ok: false,
      mode: "READ_ONLY_H1_REPLAY_INTELLIGENCE_V1",
      productionImpact: "NONE",
      request,
      asOf,
      blockers: [replay.reason ?? "H1_REPLAY_UNAVAILABLE"],
      antiLeakage: { noRowsAfterRequestedToTime: true, noInstitutionalRowsAfterTradeDate: true },
      affectsVerdict: false,
      affectsTelegram: false,
      affectsExecution: false,
      aiMayOverride: false,
      reason: replay.reason,
    };
  }

  const market = [...(replay.market ?? [])].sort((a, b) => String(a.minute_bucket).localeCompare(String(b.minute_bucket)));
  const temporal = {
    clue3m: summarizeWindow(market, 3),
    confirm6m: summarizeWindow(market, 6),
    validate15m: summarizeWindow(market, 15),
    sustain30m: summarizeWindow(market, 30),
  };

  const flowQ = await dbQuerySafe<FlowRow>(`
    SELECT trade_date, fii_net, dii_net
    FROM fii_dii_cash_daily
    WHERE trade_date <= $1::date
    ORDER BY trade_date DESC
    LIMIT 20
  `, [request.tradeDate]);
  const flowRows = flowQ?.rows ?? [];
  const windows = ([1, 3, 5, 20] as const).map((sessions) => {
    const slice = flowRows.slice(0, sessions);
    const fiiNet = sum(slice, "fii_net");
    const diiNet = sum(slice, "dii_net");
    return {
      sessions,
      availableSessions: slice.length,
      fiiNet,
      diiNet,
      combinedNet: fiiNet == null || diiNet == null ? null : fiiNet + diiNet,
    };
  });

  const latestChainMinute = (replay.chain ?? []).reduce<string | null>((max, row) => {
    const v = String(row.minute_bucket ?? "");
    return !max || v > max ? v : max;
  }, null);
  const latestOptionMinute = (replay.options ?? []).reduce<string | null>((max, row) => {
    const v = String(row.minute_bucket ?? "");
    return !max || v > max ? v : max;
  }, null);
  const latestChain = (replay.chain ?? []).filter((row) => String(row.minute_bucket ?? "") === latestChainMinute);
  const latestOptions = (replay.options ?? []).filter((row) => String(row.minute_bucket ?? "") === latestOptionMinute);

  const blockers: string[] = [];
  if (temporal.clue3m.sampleCount < 3) blockers.push("INSUFFICIENT_3M_REPLAY_ROWS");
  if (temporal.confirm6m.sampleCount < 6) blockers.push("INSUFFICIENT_6M_REPLAY_ROWS");
  if (temporal.validate15m.sampleCount < 15) blockers.push("INSUFFICIENT_15M_REPLAY_ROWS");
  if (temporal.sustain30m.sampleCount < 30) blockers.push("INSUFFICIENT_30M_REPLAY_ROWS");
  if (flowRows.length < 5) blockers.push("INSUFFICIENT_5D_FII_DII_CONTEXT");
  if (!latestChain.length) blockers.push("LATEST_CHAIN_UNAVAILABLE");
  if (!latestOptions.length) blockers.push("LATEST_OPTIONS_UNAVAILABLE");

  const requestedEndMs = Date.parse(asOf);
  const noRowsAfterRequestedToTime = [...(replay.market ?? []), ...(replay.chain ?? []), ...(replay.options ?? [])]
    .every((row) => {
      const t = Date.parse(String(row.minute_bucket ?? ""));
      return !Number.isFinite(t) || t <= requestedEndMs;
    });
  const noInstitutionalRowsAfterTradeDate = flowRows.every((r) => dateOnly(r.trade_date) <= request.tradeDate);
  if (!noRowsAfterRequestedToTime) blockers.push("LOOKAHEAD_REPLAY_ROW_DETECTED");
  if (!noInstitutionalRowsAfterTradeDate) blockers.push("LOOKAHEAD_INSTITUTIONAL_ROW_DETECTED");

  return {
    ok: blockers.every((b) => !b.startsWith("LOOKAHEAD_")),
    mode: "READ_ONLY_H1_REPLAY_INTELLIGENCE_V1",
    productionImpact: "NONE",
    request,
    asOf,
    temporal,
    institutionalContext: {
      latestAvailableTradeDate: flowRows[0] ? dateOnly(flowRows[0].trade_date) : null,
      windows,
      semantics: "AS_OF_DATE_CONTEXT_ONLY",
    },
    latestChain,
    latestOptions,
    blockers,
    antiLeakage: { noRowsAfterRequestedToTime, noInstitutionalRowsAfterTradeDate },
    affectsVerdict: false,
    affectsTelegram: false,
    affectsExecution: false,
    aiMayOverride: false,
  };
}

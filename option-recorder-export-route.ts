import type { Hono } from "hono";

type ExportSource = {
  marketSnapshot?: Record<string, any>;
  recorderSnapshots?: any[];
};

function safeExpiryDate(exp: any): string | null {
  if (!exp) return null;
  const raw = exp.expiryDate;
  if (raw instanceof Date && Number.isFinite(raw.getTime())) return raw.toISOString().slice(0, 10);
  if (typeof raw === "string" && raw.length >= 10) return raw.slice(0, 10);
  return null;
}

function cleanLeg(leg: any) {
  if (!leg) return null;
  return {
    strike: Number.isFinite(leg.strike) ? leg.strike : null,
    side: leg.optionType === "PE" ? "PE" : leg.optionType === "CE" ? "CE" : null,
    isAtm: Boolean(leg.isAtm),
    expiryDate: typeof leg.expiryDate === "string" ? leg.expiryDate : null,
    expiryBucket: typeof leg.expiryBucket === "string" ? leg.expiryBucket : null,
    tradingSymbol: typeof leg.tradingSymbol === "string" ? leg.tradingSymbol : null,
    instrumentToken: Number.isFinite(leg.instrumentToken) ? leg.instrumentToken : null,
    bid: Number.isFinite(leg.bid) && leg.bid > 0 ? leg.bid : null,
    ask: Number.isFinite(leg.ask) && leg.ask > 0 ? leg.ask : null,
    lastPrice: Number.isFinite(leg.lastPrice) && leg.lastPrice > 0 ? leg.lastPrice : null,
    volume: Number.isFinite(leg.volume) && leg.volume >= 0 ? leg.volume : null,
    oi: Number.isFinite(leg.oi) && leg.oi >= 0 ? leg.oi : null,
    iv: Number.isFinite(leg.iv) && leg.iv >= 0 ? leg.iv : null,
    delta: Number.isFinite(leg.delta) ? leg.delta : null,
    gamma: Number.isFinite(leg.gamma) ? leg.gamma : null,
    vega: Number.isFinite(leg.vega) ? leg.vega : null,
    theta: Number.isFinite(leg.theta) ? leg.theta : null,
    quoteTimestamp: typeof leg.quoteTimestamp === "string" ? leg.quoteTimestamp : null,
  };
}

function cleanIndex(m: any) {
  if (!m || m.error) return null;
  return {
    snapshotId: typeof m.snapshotId === "string" ? m.snapshotId : null,
    backendTimestamp: typeof m.timestamp === "string" ? m.timestamp : null,
    exchangeTimestamp: typeof m.exchangeTimestamp === "string" ? m.exchangeTimestamp : null,
    spot: Number.isFinite(m.spot) ? m.spot : null,
    vwap: Number.isFinite(m.vwap) ? m.vwap : null,
    pdh: Number.isFinite(m.pdh) ? m.pdh : null,
    pdl: Number.isFinite(m.pdl) ? m.pdl : null,
    dayHigh: Number.isFinite(m.dayHigh) ? m.dayHigh : null,
    dayLow: Number.isFinite(m.dayLow) ? m.dayLow : null,
    atmStrike: Number.isFinite(m.atmStrike) ? m.atmStrike : null,
    pcr: Number.isFinite(m.pcr) ? m.pcr : null,
    volumePcr: Number.isFinite(m.volumePcr) ? m.volumePcr : null,
    maxPain: Number.isFinite(m.maxPain) ? m.maxPain : null,
    futuresVwapBias: m.futuresVwapBias ?? null,
    gapScore: m.gapScore ?? null,
    futuresContracts: Array.isArray(m.futuresContracts)
      ? m.futuresContracts.map((f: any) => ({
          label: f.label ?? null,
          expiry: f.expiry ?? null,
          ltp: Number.isFinite(f.ltp) ? f.ltp : null,
          oi: Number.isFinite(f.oi) ? f.oi : null,
          volume: Number.isFinite(f.volume) ? f.volume : null,
          basis: Number.isFinite(f.basis) ? f.basis : null,
          quoteTimestamp: typeof f.quoteTimestamp === "string" ? f.quoteTimestamp : null,
        }))
      : [],
    expiries: Array.isArray(m.expiries)
      ? m.expiries.map((exp: any) => ({
          label: exp.expiry ?? null,
          expiryDate: safeExpiryDate(exp),
          ce: Array.isArray(exp.ceStrikes) ? exp.ceStrikes.map(cleanLeg).filter(Boolean) : [],
          pe: Array.isArray(exp.peStrikes) ? exp.peStrikes.map(cleanLeg).filter(Boolean) : [],
        }))
      : [],
  };
}

export function mountOptionRecorderExportRoute(app: Hono, getSource: () => ExportSource) {
  app.get("/api/option-recorder/export", (c) => {
    c.header("Cache-Control", "no-store");
    const expected = process.env.OPTION_RECORDER_EXPORT_TOKEN || "";
    if (!expected) return c.json({ ok: false, error: "EXPORT_TOKEN_NOT_CONFIGURED" }, 503);
    if (c.req.header("authorization") !== `Bearer ${expected}`) {
      return c.json({ ok: false, error: "UNAUTHORIZED" }, 401);
    }

    const source = getSource();
    const marketSnapshot = source.marketSnapshot || {};
    const out: Record<string, unknown> = {};
    for (const symbol of ["NIFTY", "BANKNIFTY", "SENSEX"] as const) {
      const cleaned = cleanIndex(marketSnapshot[symbol]);
      if (cleaned) out[symbol] = cleaned;
    }

    return c.json({
      ok: true,
      architectureRole: "OPTION_RECORDER_EXPORT_V1",
      generatedAt: new Date().toISOString(),
      symbols: out,
      recorderSnapshots: Array.isArray(source.recorderSnapshots) ? source.recorderSnapshots.slice(-20) : [],
      security: { tokenRequired: true, brokerCredentialExposed: false },
    });
  });
}

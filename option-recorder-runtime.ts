import {
  type RecorderMarketSnapshot,
  type RecorderOptionSnapshot,
  type RecorderStrategyVerdict,
  type RecorderSymbol,
  type StrategyMode,
  validateRecorderOption,
  resolveRecorderConflict,
  recorderTelegramDestination,
} from "./option-recorder-shadow.js";

export type RecorderIngestPayload = {
  market: RecorderMarketSnapshot;
  options: RecorderOptionSnapshot[];
  verdicts: RecorderStrategyVerdict[];
};

export type SelectedPremium = {
  contractKey: string;
  side: "CE" | "PE";
  expiry: string;
  strike: number;
  ltp: number;
  spreadPct: number | null;
  volume: number | null;
  oi: number | null;
};

export type RecorderProcessedState = {
  generatedAt: string;
  symbol: RecorderSymbol;
  conflict: ReturnType<typeof resolveRecorderConflict>;
  selectedPremiums: Partial<Record<StrategyMode, SelectedPremium>>;
  validOptionCount: number;
  rejectedOptionCount: number;
  telegramDestination: ReturnType<typeof recorderTelegramDestination>;
  fingerprint: string;
};

function spreadPct(o: RecorderOptionSnapshot): number | null {
  if (o.ltp == null || o.ltp <= 0 || o.bid == null || o.ask == null) return null;
  return ((o.ask - o.bid) / o.ltp) * 100;
}

export function selectRecorderPremium(
  payload: RecorderIngestPayload,
  verdict: RecorderStrategyVerdict,
): SelectedPremium | null {
  if (verdict.state !== "TRADEABLE" || verdict.direction === "NONE") return null;

  const candidates = payload.options
    .map((o) => ({ o, validation: validateRecorderOption(payload.market, o), spread: spreadPct(o) }))
    .filter(({ o, validation }) =>
      !validation.blocked &&
      o.side === verdict.direction &&
      o.ltp != null &&
      Number.isFinite(o.ltp) &&
      o.ltp > 0
    )
    .sort((a, b) => {
      const aSpread = a.spread ?? Number.POSITIVE_INFINITY;
      const bSpread = b.spread ?? Number.POSITIVE_INFINITY;
      if (aSpread !== bSpread) return aSpread - bSpread;

      const spot = payload.market.spot;
      const aDistance = spot == null ? 0 : Math.abs(a.o.strike - spot);
      const bDistance = spot == null ? 0 : Math.abs(b.o.strike - spot);
      if (aDistance !== bDistance) return aDistance - bDistance;

      const aVolume = a.o.volume ?? 0;
      const bVolume = b.o.volume ?? 0;
      if (aVolume !== bVolume) return bVolume - aVolume;

      return (b.o.oi ?? 0) - (a.o.oi ?? 0);
    });

  const best = candidates[0]?.o;
  if (!best || best.ltp == null) return null;

  return {
    contractKey: best.contractKey,
    side: best.side,
    expiry: best.expiry,
    strike: best.strike,
    ltp: best.ltp,
    spreadPct: spreadPct(best),
    volume: best.volume,
    oi: best.oi,
  };
}

export function processRecorderPayload(payload: RecorderIngestPayload): RecorderProcessedState {
  if (!payload?.market || !Array.isArray(payload.options) || !Array.isArray(payload.verdicts)) {
    throw new Error("INVALID_INGEST_PAYLOAD");
  }

  const validations = payload.options.map((o) => validateRecorderOption(payload.market, o));
  const validOptionCount = validations.filter((v) => !v.blocked).length;
  const conflict = resolveRecorderConflict(payload.verdicts);

  const selectedPremiums: Partial<Record<StrategyMode, SelectedPremium>> = {};
  for (const verdict of payload.verdicts) {
    const selected = selectRecorderPremium(payload, verdict);
    if (selected) selectedPremiums[verdict.mode] = selected;
  }

  const telegramDestination = recorderTelegramDestination(payload.market.symbol);
  const fingerprint = [
    payload.market.symbol,
    conflict,
    ...payload.verdicts.map((v) => `${v.mode}:${v.state}:${v.direction}`),
    ...Object.values(selectedPremiums).map((p) => p?.contractKey || ""),
  ].join("|");

  return {
    generatedAt: new Date().toISOString(),
    symbol: payload.market.symbol,
    conflict,
    selectedPremiums,
    validOptionCount,
    rejectedOptionCount: payload.options.length - validOptionCount,
    telegramDestination,
    fingerprint,
  };
}

export function buildHaikuEvidence(payload: RecorderIngestPayload, state: RecorderProcessedState) {
  return {
    instruction:
      "Analyze SCALP, TRADER and SWING independently. Use all supplied useful evidence. Run primary analysis, devil check, contradiction review and final synthesis. Never invent missing data, never override deterministic validation, and prefer NO_TRADE over weak conviction.",
    market: payload.market,
    verdicts: payload.verdicts,
    selectedPremiums: state.selectedPremiums,
    conflict: state.conflict,
    options: payload.options,
  };
}

export function buildTelegramText(
  payload: RecorderIngestPayload,
  state: RecorderProcessedState,
  haikuResult: string | null,
): string {
  const lines = [`${payload.market.symbol} OPTION RECORDER`, `State: ${state.conflict}`];

  for (const verdict of payload.verdicts) {
    const p = state.selectedPremiums[verdict.mode];
    lines.push(
      `${verdict.mode}: ${verdict.state} ${verdict.direction}` +
      (p ? ` | ${p.expiry} ${p.strike}${p.side} @ ${p.ltp}` : "")
    );
  }

  if (haikuResult) lines.push(`AI: ${haikuResult.slice(0, 1800)}`);
  return lines.join("\n");
}

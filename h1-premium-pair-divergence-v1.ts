export const H1_PREMIUM_PAIR_DIVERGENCE_VERSION = "H1_PREMIUM_PAIR_DIVERGENCE_V1" as const;

export type PpdSide = "CE" | "PE";
export type PpdPriceSource = "MID" | "MICROPRICE" | "LTP_REPLAY" | "LAST_FALLBACK";
export type PpdPairState =
  | "CE_CONTROLLED_EXPANSION"
  | "PE_CONTROLLED_EXPANSION"
  | "BOTH_UP"
  | "BOTH_DECAY"
  | "NEUTRAL";

export type PpdQuote = {
  timestamp: string;
  indexSymbol: string;
  expiry: string;
  strike: number;
  side: PpdSide;
  price: number;
  priceSource: PpdPriceSource;
  quoteAgeMs?: number | null;
  spreadBps?: number | null;
  stale?: boolean;
};

export type PpdWindowInput = {
  ceFrom: PpdQuote;
  ceTo: PpdQuote;
  peFrom: PpdQuote;
  peTo: PpdQuote;
};

export type PpdInvalidReason =
  | "IDENTITY_MISMATCH"
  | "INVALID_TIMESTAMP"
  | "NON_POSITIVE_ELAPSED_TIME"
  | "NON_POSITIVE_PRICE"
  | "STALE_QUOTE";

export type PpdWindowResult =
  | {
      ok: false;
      version: typeof H1_PREMIUM_PAIR_DIVERGENCE_VERSION;
      productionImpact: "NONE";
      researchOnly: true;
      reason: PpdInvalidReason;
    }
  | {
      ok: true;
      version: typeof H1_PREMIUM_PAIR_DIVERGENCE_VERSION;
      productionImpact: "NONE";
      researchOnly: true;
      indexSymbol: string;
      expiry: string;
      strike: number;
      from: string;
      to: string;
      elapsedMinutes: number;
      priceSource: {
        ceFrom: PpdPriceSource;
        ceTo: PpdPriceSource;
        peFrom: PpdPriceSource;
        peTo: PpdPriceSource;
      };
      ceReturnPct: number;
      peReturnPct: number;
      rawPpdPp: number;
      controllingSide: PpdSide | null;
      candidate: {
        side: PpdSide | null;
        expansionStrengthPct: number | null;
        oppositeReturnPct: number | null;
        oppositeCollapseStrengthPct: number | null;
        netPpdSeparationPp: number;
      };
      pairState: PpdPairState;
      windowRate: {
        rawPpdPpPerMinute: number;
        ceReturnPctPerMinute: number;
        peReturnPctPerMinute: number;
      };
      quality: {
        explicitStaleQuote: false;
        maxQuoteAgeMs: number | null;
        maxSpreadBps: number | null;
        replayUsesLtp: boolean;
      };
    };

export type PpdChangeResult =
  | { ok: false; reason: "WINDOW_INVALID" | "IDENTITY_MISMATCH" | "NON_POSITIVE_ENDPOINT_GAP" }
  | {
      ok: true;
      endpointGapMinutes: number;
      rawPpdDeltaPp: number;
      rawPpdVelocityPpPerMinute: number;
      controlFlip: boolean;
    };

function validTimestamp(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function pctChange(from: number, to: number): number {
  return ((to - from) / from) * 100;
}

function sameIdentity(quotes: PpdQuote[]): boolean {
  const [first, ...rest] = quotes;
  return rest.every((quote) =>
    quote.indexSymbol === first.indexSymbol
    && quote.expiry === first.expiry
    && quote.strike === first.strike,
  );
}

function pairState(ceReturnPct: number, peReturnPct: number): PpdPairState {
  if (ceReturnPct > 0 && peReturnPct < 0) return "CE_CONTROLLED_EXPANSION";
  if (peReturnPct > 0 && ceReturnPct < 0) return "PE_CONTROLLED_EXPANSION";
  if (ceReturnPct > 0 && peReturnPct > 0) return "BOTH_UP";
  if (ceReturnPct < 0 && peReturnPct < 0) return "BOTH_DECAY";
  return "NEUTRAL";
}

function maxFinite(values: Array<number | null | undefined>): number | null {
  const finite = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return finite.length ? Math.max(...finite) : null;
}

export function calculatePremiumPairDivergence(input: PpdWindowInput): PpdWindowResult {
  const quotes = [input.ceFrom, input.ceTo, input.peFrom, input.peTo];
  if (!sameIdentity(quotes) || input.ceFrom.side !== "CE" || input.ceTo.side !== "CE" || input.peFrom.side !== "PE" || input.peTo.side !== "PE") {
    return {
      ok: false,
      version: H1_PREMIUM_PAIR_DIVERGENCE_VERSION,
      productionImpact: "NONE",
      researchOnly: true,
      reason: "IDENTITY_MISMATCH",
    };
  }

  if (quotes.some((quote) => !Number.isFinite(quote.price) || quote.price <= 0)) {
    return {
      ok: false,
      version: H1_PREMIUM_PAIR_DIVERGENCE_VERSION,
      productionImpact: "NONE",
      researchOnly: true,
      reason: "NON_POSITIVE_PRICE",
    };
  }

  if (quotes.some((quote) => quote.stale === true)) {
    return {
      ok: false,
      version: H1_PREMIUM_PAIR_DIVERGENCE_VERSION,
      productionImpact: "NONE",
      researchOnly: true,
      reason: "STALE_QUOTE",
    };
  }

  const fromTimes = [validTimestamp(input.ceFrom.timestamp), validTimestamp(input.peFrom.timestamp)];
  const toTimes = [validTimestamp(input.ceTo.timestamp), validTimestamp(input.peTo.timestamp)];
  if (fromTimes.some((value) => value == null) || toTimes.some((value) => value == null)) {
    return {
      ok: false,
      version: H1_PREMIUM_PAIR_DIVERGENCE_VERSION,
      productionImpact: "NONE",
      researchOnly: true,
      reason: "INVALID_TIMESTAMP",
    };
  }

  const ceFromMs = fromTimes[0] as number;
  const peFromMs = fromTimes[1] as number;
  const ceToMs = toTimes[0] as number;
  const peToMs = toTimes[1] as number;
  if (ceFromMs !== peFromMs || ceToMs !== peToMs) {
    return {
      ok: false,
      version: H1_PREMIUM_PAIR_DIVERGENCE_VERSION,
      productionImpact: "NONE",
      researchOnly: true,
      reason: "IDENTITY_MISMATCH",
    };
  }

  const elapsedMinutes = (ceToMs - ceFromMs) / 60_000;
  if (!(elapsedMinutes > 0)) {
    return {
      ok: false,
      version: H1_PREMIUM_PAIR_DIVERGENCE_VERSION,
      productionImpact: "NONE",
      researchOnly: true,
      reason: "NON_POSITIVE_ELAPSED_TIME",
    };
  }

  const ceReturnPct = pctChange(input.ceFrom.price, input.ceTo.price);
  const peReturnPct = pctChange(input.peFrom.price, input.peTo.price);
  const rawPpdPp = ceReturnPct - peReturnPct;
  const controllingSide: PpdSide | null = rawPpdPp > 0 ? "CE" : rawPpdPp < 0 ? "PE" : null;
  const expansionStrengthPct = controllingSide === "CE" ? ceReturnPct : controllingSide === "PE" ? peReturnPct : null;
  const oppositeReturnPct = controllingSide === "CE" ? peReturnPct : controllingSide === "PE" ? ceReturnPct : null;
  const oppositeCollapseStrengthPct = oppositeReturnPct == null ? null : Math.max(0, -oppositeReturnPct);

  return {
    ok: true,
    version: H1_PREMIUM_PAIR_DIVERGENCE_VERSION,
    productionImpact: "NONE",
    researchOnly: true,
    indexSymbol: input.ceFrom.indexSymbol,
    expiry: input.ceFrom.expiry,
    strike: input.ceFrom.strike,
    from: new Date(ceFromMs).toISOString(),
    to: new Date(ceToMs).toISOString(),
    elapsedMinutes,
    priceSource: {
      ceFrom: input.ceFrom.priceSource,
      ceTo: input.ceTo.priceSource,
      peFrom: input.peFrom.priceSource,
      peTo: input.peTo.priceSource,
    },
    ceReturnPct,
    peReturnPct,
    rawPpdPp,
    controllingSide,
    candidate: {
      side: controllingSide,
      expansionStrengthPct,
      oppositeReturnPct,
      oppositeCollapseStrengthPct,
      netPpdSeparationPp: Math.abs(rawPpdPp),
    },
    pairState: pairState(ceReturnPct, peReturnPct),
    windowRate: {
      rawPpdPpPerMinute: rawPpdPp / elapsedMinutes,
      ceReturnPctPerMinute: ceReturnPct / elapsedMinutes,
      peReturnPctPerMinute: peReturnPct / elapsedMinutes,
    },
    quality: {
      explicitStaleQuote: false,
      maxQuoteAgeMs: maxFinite(quotes.map((quote) => quote.quoteAgeMs)),
      maxSpreadBps: maxFinite(quotes.map((quote) => quote.spreadBps)),
      replayUsesLtp: quotes.some((quote) => quote.priceSource === "LTP_REPLAY"),
    },
  };
}

export function comparePremiumPairDivergence(previous: PpdWindowResult, current: PpdWindowResult): PpdChangeResult {
  if (!previous.ok || !current.ok) return { ok: false, reason: "WINDOW_INVALID" };
  if (previous.indexSymbol !== current.indexSymbol || previous.expiry !== current.expiry || previous.strike !== current.strike) {
    return { ok: false, reason: "IDENTITY_MISMATCH" };
  }
  const previousTo = validTimestamp(previous.to);
  const currentTo = validTimestamp(current.to);
  if (previousTo == null || currentTo == null || currentTo <= previousTo) {
    return { ok: false, reason: "NON_POSITIVE_ENDPOINT_GAP" };
  }
  const endpointGapMinutes = (currentTo - previousTo) / 60_000;
  const rawPpdDeltaPp = current.rawPpdPp - previous.rawPpdPp;
  return {
    ok: true,
    endpointGapMinutes,
    rawPpdDeltaPp,
    rawPpdVelocityPpPerMinute: rawPpdDeltaPp / endpointGapMinutes,
    controlFlip: previous.controllingSide !== null
      && current.controllingSide !== null
      && previous.controllingSide !== current.controllingSide,
  };
}

export function candidatePpdForSide(result: PpdWindowResult, side: PpdSide): number | null {
  if (!result.ok) return null;
  return side === "CE" ? result.rawPpdPp : -result.rawPpdPp;
}

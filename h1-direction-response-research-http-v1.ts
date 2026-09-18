import {
  parseH1ReplayRequest,
  runH1ReplayHttp,
  type H1ReplayHttpResult,
} from "./h1-replay-http.js";
import {
  buildH1DirectionResponseResearch,
  type H1DirectionResponseResearchResult,
} from "./h1-direction-response-research-v1.js";

export const H1_DIRECTION_RESPONSE_RESEARCH_HTTP_VERSION = "H1_DIRECTION_RESPONSE_RESEARCH_HTTP_V1" as const;

export interface H1DirectionResponseResearchHttpInput {
  symbol?: string | null;
  dates?: string | null;
  fromTime?: string | null;
  toTime?: string | null;
  scope?: string | null;
}

export interface H1DirectionResponseReplaySummary {
  tradeDate: string;
  counts: H1ReplayHttpResult["counts"] | null;
  continuity: H1ReplayHttpResult["continuity"] | null;
}

export interface H1DirectionResponseResearchHttpResult {
  ok: boolean;
  version: typeof H1_DIRECTION_RESPONSE_RESEARCH_HTTP_VERSION;
  mode: "READ_ONLY_H1_DIRECTION_RESPONSE_RESEARCH_HTTP_V1";
  productionImpact: "NONE";
  request: {
    symbol: string;
    dates: string[];
    fromTime: string;
    toTime: string;
    scope: string;
  } | null;
  replaySummaries: H1DirectionResponseReplaySummary[];
  research: H1DirectionResponseResearchResult | null;
  reason?: string;
  failedTradeDate?: string;
  safety: {
    readOnly: true;
    thresholdSelected: false;
    thresholdPromoted: false;
    affectsSelector: false;
    affectsTelegram: false;
    affectsVerdict: false;
    affectsExecution: false;
    createsOrders: false;
    grantsPromotionAuthority: false;
    failClosed: true;
  };
}

type ReplayRunner = (request: Parameters<typeof runH1ReplayHttp>[0]) => Promise<H1ReplayHttpResult>;

const BASE = {
  version: H1_DIRECTION_RESPONSE_RESEARCH_HTTP_VERSION,
  mode: "READ_ONLY_H1_DIRECTION_RESPONSE_RESEARCH_HTTP_V1" as const,
  productionImpact: "NONE" as const,
  safety: {
    readOnly: true as const,
    thresholdSelected: false as const,
    thresholdPromoted: false as const,
    affectsSelector: false as const,
    affectsTelegram: false as const,
    affectsVerdict: false as const,
    affectsExecution: false as const,
    createsOrders: false as const,
    grantsPromotionAuthority: false as const,
    failClosed: true as const,
  },
};

function parseDates(raw: string | null | undefined): { ok: true; dates: string[] } | { ok: false; reason: string } {
  const dates = String(raw ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  if (dates.length < 1 || dates.length > 8) return { ok: false, reason: "DATES_REQUIRE_1_TO_8" };
  if (new Set(dates).size !== dates.length) return { ok: false, reason: "DUPLICATE_DATES_NOT_ALLOWED" };
  return { ok: true, dates };
}

export async function runH1DirectionResponseResearchHttp(
  input: H1DirectionResponseResearchHttpInput,
  replayRunner: ReplayRunner = runH1ReplayHttp,
): Promise<H1DirectionResponseResearchHttpResult> {
  const dateParse = parseDates(input.dates);
  if (!dateParse.ok) {
    return { ...BASE, ok: false, request: null, replaySummaries: [], research: null, reason: dateParse.reason };
  }

  const parsedRequests = [] as Array<ReturnType<typeof parseH1ReplayRequest> & { tradeDate?: string }>;
  for (const tradeDate of dateParse.dates) {
    const parsed = parseH1ReplayRequest({
      symbol: input.symbol,
      tradeDate,
      fromTime: input.fromTime,
      toTime: input.toTime,
      scope: input.scope,
    });
    if (!parsed.ok) {
      return {
        ...BASE,
        ok: false,
        request: null,
        replaySummaries: [],
        research: null,
        reason: parsed.reason,
        failedTradeDate: tradeDate,
      };
    }
    parsedRequests.push({ ...parsed, tradeDate });
  }

  const first = parsedRequests[0];
  if (!first?.ok) {
    return { ...BASE, ok: false, request: null, replaySummaries: [], research: null, reason: "NO_VALID_REQUESTS" };
  }

  const request = {
    symbol: first.value.symbol,
    dates: dateParse.dates,
    fromTime: first.value.fromTime,
    toTime: first.value.toTime,
    scope: first.value.scope,
  };
  const replaySummaries: H1DirectionResponseReplaySummary[] = [];
  const researchInputs: Array<{ tradeDate: string; replay: H1ReplayHttpResult }> = [];

  // Sequential by design: research-only and must not fan out heavy FULL replay queries against production PostgreSQL.
  for (const parsed of parsedRequests) {
    if (!parsed.ok) continue;
    const replay = await replayRunner(parsed.value);
    replaySummaries.push({
      tradeDate: parsed.value.tradeDate,
      counts: replay.counts ?? null,
      continuity: replay.continuity ?? null,
    });
    if (!replay.ok) {
      return {
        ...BASE,
        ok: false,
        request,
        replaySummaries,
        research: null,
        reason: replay.reason ?? "H1_REPLAY_FAILED",
        failedTradeDate: parsed.value.tradeDate,
      };
    }
    researchInputs.push({ tradeDate: parsed.value.tradeDate, replay });
  }

  return {
    ...BASE,
    ok: true,
    request,
    replaySummaries,
    research: buildH1DirectionResponseResearch(researchInputs),
  };
}

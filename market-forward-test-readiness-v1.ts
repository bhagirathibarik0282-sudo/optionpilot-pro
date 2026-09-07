import type { H1ReplayHttpResult } from "./h1-replay-http.js";
import type { BusinessDashboardV1Model } from "./business-dashboard-v1.js";
import { buildH1PositioningChangeEvidence, type H1PositioningSnapshot } from "./h1-positioning-change-evidence.js";

export const MARKET_FORWARD_TEST_READINESS_V1 = "MARKET_FORWARD_TEST_READINESS_V1" as const;
export type MarketForwardTestSymbol = "NIFTY" | "SENSEX";

type AnyRecord = Record<string, unknown>;

export interface MarketForwardTestReadinessInput {
  symbol: MarketForwardTestSymbol;
  replay: H1ReplayHttpResult;
  dashboard: BusinessDashboardV1Model;
  telegramAcceptance: unknown;
  fiiDiiContext: unknown;
  marketDnaContext: unknown;
}

function record(value: unknown): AnyRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as AnyRecord : null;
}

function finite(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isoMs(value: unknown): number | null {
  const n = Date.parse(String(value ?? ""));
  return Number.isFinite(n) ? n : null;
}

function optionOiTruth(replay: H1ReplayHttpResult) {
  const rows = replay.options ?? [];
  let derivedRows = 0;
  let badProvenanceRows = 0;
  let badGapRows = 0;
  let separateNativeAndDerivedFieldsObserved = false;
  const sources = new Set<string>();

  for (const row of rows) {
    const derived = finite(row.derived_oi_change);
    if (derived == null) continue;
    derivedRows += 1;
    const source = text(row.derived_oi_change_source);
    const gap = finite(row.derived_oi_change_gap_seconds);
    if (source) sources.add(source);
    if (source !== "DERIVED_PREVIOUS_PERSISTED_SNAPSHOT") badProvenanceRows += 1;
    if (gap == null || gap <= 0) badGapRows += 1;
    if (Object.prototype.hasOwnProperty.call(row, "oi_change") && Object.prototype.hasOwnProperty.call(row, "derived_oi_change")) {
      separateNativeAndDerivedFieldsObserved = true;
    }
  }

  const ready = rows.length > 0 && derivedRows > 0 && badProvenanceRows === 0 && badGapRows === 0 && separateNativeAndDerivedFieldsObserved;
  return {
    ready,
    optionRows: rows.length,
    derivedRows,
    badProvenanceRows,
    badGapRows,
    provenanceSources: [...sources],
    separateNativeAndDerivedFieldsObserved,
    firstObservationSemantics: "NULL_UNTIL_PRIOR_SAME_CONTRACT_SAME_IST_DAY" as const,
    expectedProvenance: "DERIVED_PREVIOUS_PERSISTED_SNAPSHOT" as const,
    blocker: ready ? null : rows.length === 0 ? "OPTION_ROWS_NOT_OBSERVED" : derivedRows === 0 ? "DERIVED_OI_NOT_OBSERVED_YET" : "DERIVED_OI_TRUTH_INVALID",
  };
}

function positioningTruth(replay: H1ReplayHttpResult) {
  const chain = replay.chain ?? [];
  const byExpiry = new Map<string, AnyRecord[]>();
  for (const row of chain) {
    const expiry = text(row.expiry);
    if (!expiry) continue;
    const bucket = byExpiry.get(expiry) ?? [];
    bucket.push(row);
    byExpiry.set(expiry, bucket);
  }

  const expiries = [...byExpiry.keys()].sort();
  for (const expiry of expiries) {
    const rows = (byExpiry.get(expiry) ?? []).filter((r) => isoMs(r.minute_bucket) != null).sort((a, b) => (isoMs(a.minute_bucket) ?? 0) - (isoMs(b.minute_bucket) ?? 0));
    const uniqueByTime = new Map<number, AnyRecord>();
    for (const row of rows) uniqueByTime.set(isoMs(row.minute_bucket)!, row);
    const ordered = [...uniqueByTime.entries()].sort((a, b) => a[0] - b[0]).map(([, row]) => row);
    if (ordered.length < 2) continue;
    const previous = ordered.at(-2)!;
    const current = ordered.at(-1)!;
    const snapshot = (row: AnyRecord): H1PositioningSnapshot | null => {
      const observedAt = text(row.minute_bucket);
      const fullChainOiPcr = finite(row.full_chain_oi_pcr);
      const band7OiPcr = finite(row.band7_oi_pcr);
      const volumePcr = finite(row.volume_pcr);
      const callWallStrike = finite(row.call_wall_strike);
      const callWallStrength = finite(row.call_wall_strength);
      const putWallStrike = finite(row.put_wall_strike);
      const putWallStrength = finite(row.put_wall_strength);
      if (!observedAt || [fullChainOiPcr, band7OiPcr, volumePcr, callWallStrike, callWallStrength, putWallStrike, putWallStrength].some((x) => x == null)) return null;
      return {
        symbol: replay.request!.symbol,
        expiry,
        observedAt,
        fullChainOiPcr: fullChainOiPcr!,
        band7OiPcr: band7OiPcr!,
        volumePcr: volumePcr!,
        callWallStrike: callWallStrike!,
        callWallStrength: callWallStrength!,
        putWallStrike: putWallStrike!,
        putWallStrength: putWallStrength!,
      };
    };
    const result = buildH1PositioningChangeEvidence(snapshot(previous), snapshot(current), { maxObservationGapMs: 6 * 60_000 });
    if (result.ready) return result;
  }

  return {
    version: "H1_POSITIONING_CHANGE_EVIDENCE_V1" as const,
    ready: false,
    semantics: "POSITIONING_CHANGE_CONTEXT_ONLY_NO_DIRECTION_TRUTH" as const,
    blockers: [chain.length < 2 ? "POSITIONING_ROWS_NOT_OBSERVED" : "NO_VALID_CONSECUTIVE_POSITIONING_PAIR"],
    grantsPromotionAuthority: false as const,
    affectsTelegram: false as const,
    affectsExecution: false as const,
  };
}

function telegramProof(symbol: MarketForwardTestSymbol, value: unknown) {
  const root = record(value);
  const symbols = record(root?.symbols);
  const symbolState = record(symbols?.[symbol]);
  const acceptance = text(symbolState?.acceptance);
  const journal = record(symbolState?.journal);
  const latest = record(journal?.latest);
  const meaningfulContractKey = text(latest?.candidateKey);
  return {
    ready: acceptance === "PASS_MEANINGFUL_EVENT_AND_JOURNAL_VERIFIED",
    acceptance: acceptance ?? "NO_ACCEPTANCE_STATE",
    meaningfulContractKey,
    blocker: acceptance === "PASS_MEANINGFUL_EVENT_AND_JOURNAL_VERIFIED" ? null : "MEANINGFUL_TELEGRAM_LIVE_PROOF_PENDING",
  };
}

function expectedMeaningfulContractKey(dashboard: BusinessDashboardV1Model): string | null {
  const candidate = dashboard.candidate;
  if (!candidate) return null;
  return `${candidate.symbol}|${candidate.expiryDate}|${candidate.strike}|${candidate.optionSide}`;
}

function contextState(value: unknown, fallback: string) {
  const root = record(value);
  const ready = root?.ready === true;
  const blockers = Array.isArray(root?.blockers) ? root.blockers.map(String) : [];
  return { ready, blockers, state: ready ? "READY" as const : "WAIT" as const, reason: text(root?.reason) ?? (blockers[0] ?? fallback) };
}

export function buildMarketForwardTestReadiness(input: MarketForwardTestReadinessInput) {
  const replaySymbolMatches = input.replay.request?.symbol === input.symbol;
  const recorderReady = replaySymbolMatches && input.replay.ok === true && (input.replay.counts?.market ?? 0) > 0 && (input.replay.counts?.options ?? 0) > 0 && (input.replay.counts?.chain ?? 0) > 1;
  const oi = optionOiTruth(input.replay);
  const positioning = positioningTruth(input.replay);
  const dashboardCandidateKey = input.dashboard.candidate?.candidateKey ?? null;
  const dashboardReady = input.dashboard.symbol === input.symbol && input.dashboard.ready === true && dashboardCandidateKey != null;
  const telegram = telegramProof(input.symbol, input.telegramAcceptance);
  const expectedContractKey = expectedMeaningfulContractKey(input.dashboard);
  const sameContractIdentity = expectedContractKey != null && telegram.meaningfulContractKey != null && expectedContractKey === telegram.meaningfulContractKey;
  const fiiDii = contextState(input.fiiDiiContext, "FII_DII_CONTEXT_PENDING");
  const marketDna = contextState(input.marketDnaContext, "MARKET_DNA_CONTEXT_PENDING");

  const liveBlockers: string[] = [];
  if (!replaySymbolMatches) liveBlockers.push("H1_REPLAY_SYMBOL_MISMATCH");
  if (!recorderReady) liveBlockers.push("H1_RECORDER_EVIDENCE_PENDING");
  if (!oi.ready) liveBlockers.push(oi.blocker ?? "DERIVED_OI_PROOF_PENDING");
  if (!positioning.ready) liveBlockers.push("POSITIONING_CONTEXT_PROOF_PENDING");
  if (!dashboardReady) liveBlockers.push("CANONICAL_BUYER_CANDIDATE_PENDING");
  if (!telegram.ready) liveBlockers.push("MEANINGFUL_TELEGRAM_LIVE_PROOF_PENDING");
  if (dashboardReady && telegram.ready && !sameContractIdentity) liveBlockers.push("DASHBOARD_TELEGRAM_CONTRACT_IDENTITY_MISMATCH");

  const forwardEvidenceReady = liveBlockers.length === 0;
  return {
    version: MARKET_FORWARD_TEST_READINESS_V1,
    mode: "READ_ONLY_MARKET_FORWARD_TEST_READINESS_V1" as const,
    productionImpact: "NONE" as const,
    symbol: input.symbol,
    tradeDate: input.replay.request?.tradeDate ?? null,
    developmentReady: true,
    state: forwardEvidenceReady ? "STRICT_FORWARD_EVIDENCE_PROVEN" as const : "DEVELOPMENT_READY_LIVE_PROOF_PENDING" as const,
    forwardEvidenceReady,
    liveBlockers: [...new Set(liveBlockers)],
    gates: {
      recorder: { ready: recorderReady, replaySymbolMatches, counts: input.replay.counts ?? null, continuity: input.replay.continuity ?? null },
      derivedOiTruth: oi,
      positioningContext: positioning,
      canonicalBusiness: { ready: dashboardReady, canonicalCandidateKey: dashboardCandidateKey, expectedMeaningfulContractKey: expectedContractKey, horizons: input.dashboard.horizons, state: input.dashboard.state },
      meaningfulTelegram: telegram,
      sameContractIdentityDashboardMeaningfulTelegram: sameContractIdentity,
      identitySemantics: "CONTRACT_IDENTITY_ONLY_CANONICAL_TRANSPORT_AUTHORITY_IS_SEPARATE" as const,
    },
    context: {
      fiiDii,
      marketDna,
      contextDoesNotCreateDirection: true,
      contextDoesNotBlockDevelopmentReadiness: true,
    },
    forwardTestPolicy: {
      strictForwardOnly: true,
      postT0EvidenceMayNotFeedBackIntoCandidateAuthority: true,
      missingEvidenceMayNotBeFabricated: true,
      contextOnlyPositioningMayNotBecomeDirectionalVote: true,
      selectorMayNotBeRerankedHere: true,
    },
    safety: {
      readOnly: true,
      selectorChanged: false,
      telegramPayloadChanged: false,
      candidateAuthorityChanged: false,
      executionEnabled: false,
      brokerCallMade: false,
      placesOrder: false,
      failClosed: true,
    },
  };
}

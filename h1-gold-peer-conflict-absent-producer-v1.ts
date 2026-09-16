import {
  CANONICAL_ONE_ROOF_MARKET_SNAPSHOT_V2,
  buildCanonicalOneRoofMarketSnapshot,
  type CanonicalOneRoofMarketSnapshot,
} from "./canonical-one-roof-market-snapshot.js";
import type {
  H1ExactLiveSpotDirection,
  H1ExactLiveSpotDirectionResult,
  H1ExactLiveSpotSymbol,
} from "./h1-exact-live-spot-direction-provider.js";
import type { H1GoldExactFamilySignal } from "./h1-gold-evidence-adapter-v1.js";

export const H1_GOLD_PEER_CONFLICT_ABSENT_PRODUCER_V1 = "H1_GOLD_PEER_CONFLICT_ABSENT_PRODUCER_V1" as const;
export const H1_GOLD_PEER_CONFLICT_ABSENT_SOURCE = "H1_GOLD_EXACT_PEER_CONFLICT_ABSENT_V1" as const;

export type H1GoldPeerTargetSymbol = "NIFTY" | "SENSEX";
export type H1GoldPeerSymbol = "NIFTY" | "SENSEX" | "BANKNIFTY";

export interface H1GoldPeerConflictAbsentInput {
  symbol: H1GoldPeerTargetSymbol;
  side: "CE" | "PE";
  observedAt: string;
  canonicalSnapshot: CanonicalOneRoofMarketSnapshot;
  targetDirectionSource: H1ExactLiveSpotDirectionResult;
  peerDirectionSources: H1ExactLiveSpotDirectionResult[];
}

export interface H1GoldPeerConflictAbsentResult {
  version: typeof H1_GOLD_PEER_CONFLICT_ABSENT_PRODUCER_V1;
  ready: boolean;
  state: "PASS" | "FAIL" | "MISSING";
  symbol: H1GoldPeerTargetSymbol;
  side: "CE" | "PE";
  observedAt: string;
  targetDirection: H1ExactLiveSpotDirection | null;
  expectedPeerSymbols: H1GoldPeerSymbol[];
  validatedPeerSymbols: H1GoldPeerSymbol[];
  conflictingPeerSymbols: H1GoldPeerSymbol[];
  peerDirections: Partial<Record<H1GoldPeerSymbol, H1ExactLiveSpotDirection>>;
  signal: H1GoldExactFamilySignal;
  blockers: string[];
  productionImpact: "NONE";
  affectsSelector: false;
  affectsTelegram: false;
  affectsExecution: false;
  grantsPromotionAuthority: false;
  createsOrders: false;
  calculatesThresholds: false;
  usesConsensusVote: false;
  optionSideDirectionInferred: false;
  failClosed: true;
  semantics: "EXACT_TARGET_AND_ALL_REQUIRED_PEER_DIRECTIONS_AT_CANONICAL_DECISION_TIME_NO_ALIAS_NO_CONSENSUS_NO_THRESHOLD";
}

const SEMANTICS = "EXACT_TARGET_AND_ALL_REQUIRED_PEER_DIRECTIONS_AT_CANONICAL_DECISION_TIME_NO_ALIAS_NO_CONSENSUS_NO_THRESHOLD" as const;

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function validIso(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function expectedPeers(symbol: H1GoldPeerTargetSymbol): H1GoldPeerSymbol[] {
  return symbol === "NIFTY" ? ["BANKNIFTY", "SENSEX"] : ["NIFTY", "BANKNIFTY"];
}

function validateCanonical(input: H1GoldPeerConflictAbsentInput): string[] {
  const reasons: string[] = [];
  const snapshot = input?.canonicalSnapshot;
  const observedAtMs = validIso(input?.observedAt) ? Date.parse(input.observedAt) : Number.NaN;

  if (!snapshot) return ["MISSING_CANONICAL_SNAPSHOT"];
  if (snapshot.version !== CANONICAL_ONE_ROOF_MARKET_SNAPSHOT_V2) reasons.push("INVALID_CANONICAL_SNAPSHOT_VERSION");
  if (!snapshot.snapshotId?.trim()) reasons.push("MISSING_CANONICAL_SNAPSHOT_ID");
  if (snapshot.symbol !== input.symbol) reasons.push("CANONICAL_SYMBOL_MISMATCH");
  if (!Number.isFinite(observedAtMs)) reasons.push("INVALID_CANDIDATE_TIMESTAMP");
  if (!Number.isFinite(snapshot.asOfMs) || snapshot.asOfMs !== observedAtMs) reasons.push("CANONICAL_DECISION_TIMESTAMP_MISMATCH");

  const rebuilt = buildCanonicalOneRoofMarketSnapshot({
    snapshotId: snapshot.snapshotId,
    symbol: snapshot.symbol,
    asOfMs: snapshot.asOfMs,
    minuteClosed: snapshot.minuteClosed,
    connectionId: snapshot.connectionId,
    instrumentMasterVersion: snapshot.instrumentMasterVersion,
    components: snapshot.components,
    freshnessBudgetsMs: snapshot.freshnessBudgetsMs,
    ingestTelemetry: snapshot.ingestTelemetry,
  });

  if (!rebuilt.readyForStrictFiltering) reasons.push("CANONICAL_NOT_READY_FOR_STRICT_FILTERING");
  if (rebuilt.qualityState !== "VERIFIED") reasons.push("CANONICAL_QUALITY_NOT_VERIFIED");
  if (rebuilt.newEntryGate !== "ALLOW_NEW_ENTRIES") reasons.push("CANONICAL_NEW_ENTRY_GATE_BLOCKED");
  if (rebuilt.internalBlockers.length > 0) reasons.push("CANONICAL_INTERNAL_BLOCKERS_PRESENT");
  return unique(reasons);
}

function validateExactDirection(
  row: H1ExactLiveSpotDirectionResult | null | undefined,
  expectedSymbol: H1ExactLiveSpotSymbol,
  observedAt: string,
): string[] {
  const reasons: string[] = [];
  if (!row) return [`${expectedSymbol}:DIRECTION_SOURCE_MISSING`];
  if (row.version !== "H1_EXACT_LIVE_SPOT_DIRECTION_PROVIDER_V1") reasons.push(`${expectedSymbol}:INVALID_DIRECTION_VERSION`);
  if (row.source !== "VERIFIED_DETERMINISTIC_RUNTIME" || row.sourceId !== "H1_EXACT_LIVE_SPOT_DIRECTION_PROVIDER_V1") {
    reasons.push(`${expectedSymbol}:INVALID_DIRECTION_SOURCE`);
  }
  if (row.liveRuntimeExact !== true || row.deterministic !== true || row.failClosed !== true) {
    reasons.push(`${expectedSymbol}:DIRECTION_NOT_EXACT_DETERMINISTIC`);
  }
  if (row.productionImpact !== "NONE" || row.affectsVerdict !== false || row.affectsExecution !== false || row.grantsPromotionAuthority !== false) {
    reasons.push(`${expectedSymbol}:UNSAFE_DIRECTION_AUTHORITY`);
  }
  if (row.ready !== true || (row.direction !== "UP" && row.direction !== "DOWN")) reasons.push(`${expectedSymbol}:DIRECTION_NOT_READY`);
  if (row.symbol !== expectedSymbol) reasons.push(`${expectedSymbol}:DIRECTION_SYMBOL_MISMATCH`);
  if (!Array.isArray(row.blockers) || row.blockers.length > 0) reasons.push(`${expectedSymbol}:DIRECTION_SOURCE_BLOCKED`);
  if (!validIso(row.previousObservedAt) || !validIso(row.currentObservedAt)) {
    reasons.push(`${expectedSymbol}:DIRECTION_TIMESTAMP_INVALID`);
  } else {
    if (Date.parse(row.previousObservedAt) >= Date.parse(row.currentObservedAt)) reasons.push(`${expectedSymbol}:DIRECTION_CHRONOLOGY_INVALID`);
    if (row.currentObservedAt !== observedAt) reasons.push(`${expectedSymbol}:NOT_EXACT_CANONICAL_DECISION_TIMESTAMP`);
  }
  if (!Number.isFinite(row.spotMovePct) || row.spotMovePct === 0) {
    reasons.push(`${expectedSymbol}:SPOT_MOVE_ATTESTATION_INVALID`);
  } else if ((row.direction === "UP" && row.spotMovePct! <= 0) || (row.direction === "DOWN" && row.spotMovePct! >= 0)) {
    reasons.push(`${expectedSymbol}:SPOT_MOVE_DIRECTION_INCONSISTENT`);
  }
  return unique(reasons);
}

function signal(
  state: "PASS" | "FAIL" | "MISSING",
  snapshotId: string,
  observedAt: string,
  reasons: string[],
): H1GoldExactFamilySignal {
  return {
    state,
    source: H1_GOLD_PEER_CONFLICT_ABSENT_SOURCE,
    snapshotId,
    observedAt,
    provenance: "LIVE_RUNTIME_EXACT",
    reasonCodes: unique(reasons),
  };
}

/**
 * Exact peer-conflict evidence for Gold research eligibility.
 *
 * The producer never computes a peer threshold or majority consensus. It uses
 * the already-validated independent spot-direction provider for the target and
 * both other tracked indices at the exact canonical decision timestamp.
 * An explicit opposite-direction peer proves peerConflictAbsent=FAIL. Missing,
 * duplicated, stale, wrong-symbol or non-exact peer evidence remains MISSING.
 */
export function buildH1GoldPeerConflictAbsent(
  input: H1GoldPeerConflictAbsentInput,
): H1GoldPeerConflictAbsentResult {
  const symbol = input?.symbol === "SENSEX" ? "SENSEX" : "NIFTY";
  const side = input?.side === "PE" ? "PE" : "CE";
  const observedAt = validIso(input?.observedAt) ? input.observedAt : new Date(0).toISOString();
  const snapshotId = input?.canonicalSnapshot?.snapshotId?.trim() || "MISSING_CANONICAL_SNAPSHOT";
  const peers = expectedPeers(symbol);
  const canonicalBlockers = validateCanonical(input);
  const targetBlockers = validateExactDirection(input?.targetDirectionSource, symbol, observedAt);
  const targetDirection = targetBlockers.length === 0 ? input.targetDirectionSource.direction : null;
  const bindingBlockers: string[] = [];

  if (input?.symbol !== "NIFTY" && input?.symbol !== "SENSEX") bindingBlockers.push("INVALID_GOLD_TARGET_SYMBOL");
  if (input?.side !== "CE" && input?.side !== "PE") bindingBlockers.push("INVALID_GOLD_OPTION_SIDE");
  if (targetDirection === "UP" && side !== "CE") bindingBlockers.push("TARGET_DIRECTION_CONFLICTS_WITH_SELECTED_OPTION_SIDE");
  if (targetDirection === "DOWN" && side !== "PE") bindingBlockers.push("TARGET_DIRECTION_CONFLICTS_WITH_SELECTED_OPTION_SIDE");

  const rows = Array.isArray(input?.peerDirectionSources) ? input.peerDirectionSources : [];
  const peerBlockers: string[] = [];
  const validatedPeerSymbols: H1GoldPeerSymbol[] = [];
  const conflictingPeerSymbols: H1GoldPeerSymbol[] = [];
  const peerDirections: Partial<Record<H1GoldPeerSymbol, H1ExactLiveSpotDirection>> = {};

  const seenSymbols = rows.map((row) => row?.symbol).filter((value): value is H1GoldPeerSymbol => value === "NIFTY" || value === "SENSEX" || value === "BANKNIFTY");
  for (const peer of peers) {
    const matches = rows.filter((row) => row?.symbol === peer);
    if (matches.length !== 1) {
      peerBlockers.push(`${peer}:${matches.length === 0 ? "PEER_DIRECTION_MISSING" : "PEER_DIRECTION_DUPLICATE"}`);
      continue;
    }
    const row = matches[0];
    const rowBlockers = validateExactDirection(row, peer, observedAt);
    if (rowBlockers.length > 0) {
      peerBlockers.push(...rowBlockers);
      continue;
    }
    validatedPeerSymbols.push(peer);
    peerDirections[peer] = row.direction!;
    if (targetDirection && row.direction !== targetDirection) conflictingPeerSymbols.push(peer);
  }

  for (const row of rows) {
    if (row?.symbol === symbol) peerBlockers.push(`${symbol}:TARGET_DIRECTION_REUSED_AS_PEER`);
    else if (row?.symbol && !peers.includes(row.symbol)) peerBlockers.push(`${row.symbol}:UNEXPECTED_PEER_SYMBOL`);
    else if (!row?.symbol) peerBlockers.push("UNATTESTED_PEER_SYMBOL");
  }
  for (const peer of peers) {
    if (seenSymbols.filter((value) => value === peer).length > 1) peerBlockers.push(`${peer}:PEER_DIRECTION_DUPLICATE`);
  }
  if (rows.length !== peers.length) peerBlockers.push("EXACT_REQUIRED_PEER_SET_NOT_SATISFIED");

  const rootBlockers = unique([...canonicalBlockers, ...targetBlockers, ...bindingBlockers]);
  const allPeerBlockers = unique(peerBlockers);
  let state: "PASS" | "FAIL" | "MISSING";
  let reasons: string[];

  if (rootBlockers.length > 0) {
    state = "MISSING";
    reasons = rootBlockers;
  } else if (conflictingPeerSymbols.length > 0) {
    state = "FAIL";
    reasons = unique([
      ...conflictingPeerSymbols.map((peer) => `EXPLICIT_PEER_DIRECTION_CONFLICT:${peer}`),
      ...allPeerBlockers,
    ]);
  } else if (allPeerBlockers.length > 0 || validatedPeerSymbols.length !== peers.length) {
    state = "MISSING";
    reasons = unique([
      ...allPeerBlockers,
      ...(validatedPeerSymbols.length !== peers.length ? ["ALL_REQUIRED_PEERS_NOT_EXACTLY_VALIDATED"] : []),
    ]);
  } else {
    state = "PASS";
    reasons = ["TARGET_AND_ALL_REQUIRED_PEERS_EXACT_DIRECTION_ALIGNED"];
  }

  const outSignal = signal(state, snapshotId, observedAt, reasons);
  return {
    version: H1_GOLD_PEER_CONFLICT_ABSENT_PRODUCER_V1,
    ready: state !== "MISSING",
    state,
    symbol,
    side,
    observedAt,
    targetDirection,
    expectedPeerSymbols: peers,
    validatedPeerSymbols,
    conflictingPeerSymbols,
    peerDirections,
    signal: outSignal,
    blockers: state === "PASS" ? [] : reasons,
    productionImpact: "NONE",
    affectsSelector: false,
    affectsTelegram: false,
    affectsExecution: false,
    grantsPromotionAuthority: false,
    createsOrders: false,
    calculatesThresholds: false,
    usesConsensusVote: false,
    optionSideDirectionInferred: false,
    failClosed: true,
    semantics: SEMANTICS,
  };
}

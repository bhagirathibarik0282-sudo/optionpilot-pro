import type { H1LiveExactRawEvidenceStatus } from "./h1-live-exact-raw-evidence-store.js";
import type { KiteImmediateTokenEntry } from "./kite-immediate-token-registry.js";

export interface H1NearestValidMonthlyPeerReadinessRow {
  symbol: "NIFTY" | "SENSEX" | "BANKNIFTY";
  primaryExpiry: string | null;
  nearestPeerExpiry: string | null;
  ready: boolean;
  primaryReady: boolean;
  peerExpectedTokenCount: number;
  peerFreshTokenCount: number;
  blockers: string[];
}

export interface H1NearestValidMonthlyPeerReadinessResult {
  version: "H1_NEAREST_VALID_MONTHLY_PEER_READINESS_V1";
  rows: H1NearestValidMonthlyPeerReadinessRow[];
  productionImpact: "NONE";
  readOnly: true;
  forwardsDownstream: false;
  affectsDirection: false;
  affectsVerdict: false;
  affectsExecution: false;
  affectsTelegram: false;
  failClosed: true;
}

function isSupportedSymbol(value: string): value is "NIFTY" | "SENSEX" | "BANKNIFTY" {
  return value === "NIFTY" || value === "SENSEX" || value === "BANKNIFTY";
}

export function buildNearestValidMonthlyPeerReadiness(
  entries: KiteImmediateTokenEntry[],
  evidence: H1LiveExactRawEvidenceStatus,
): H1NearestValidMonthlyPeerReadinessResult {
  const freshTokens = new Set(evidence.rows.map((row) => row.instrumentToken));
  const symbols = [...new Set(entries.map((entry) => entry.symbol).filter(isSupportedSymbol))];

  const rows = symbols.map((symbol): H1NearestValidMonthlyPeerReadinessRow => {
    const symbolEntries = entries.filter((entry) => entry.symbol === symbol && (entry.role === "SPOT" || entry.role === "OPTION"));
    const optionExpiries = [...new Set(symbolEntries
      .filter((entry) => entry.role === "OPTION" && entry.expiry)
      .map((entry) => entry.expiry!))].sort();

    const primaryExpiry = optionExpiries[0] ?? null;
    const nearestPeerExpiry = optionExpiries[1] ?? null;
    const primary = evidence.symbolReadiness.find((row) => row.symbol === symbol);
    const primaryReady = primary?.primaryReady === true;
    const peerEntries = nearestPeerExpiry
      ? symbolEntries.filter((entry) => entry.role === "OPTION" && entry.expiry === nearestPeerExpiry)
      : [];
    const peerFreshTokenCount = peerEntries.filter((entry) => freshTokens.has(entry.instrumentToken)).length;
    const blockers: string[] = [];

    if (!primaryReady) blockers.push("PRIMARY_EVIDENCE_NOT_READY");
    if (!nearestPeerExpiry) blockers.push("NEAREST_PEER_EXPIRY_UNAVAILABLE");
    if (nearestPeerExpiry && peerEntries.length !== 2) blockers.push(`NEAREST_PEER_PAIR_INVALID:${peerEntries.length}/2`);
    if (nearestPeerExpiry && peerFreshTokenCount !== peerEntries.length) {
      blockers.push(`NEAREST_PEER_EVIDENCE_INCOMPLETE:${peerFreshTokenCount}/${peerEntries.length}`);
    }

    return {
      symbol,
      primaryExpiry,
      nearestPeerExpiry,
      ready: primaryReady && nearestPeerExpiry != null && peerEntries.length === 2 && peerFreshTokenCount === 2,
      primaryReady,
      peerExpectedTokenCount: peerEntries.length,
      peerFreshTokenCount,
      blockers,
    };
  });

  return {
    version: "H1_NEAREST_VALID_MONTHLY_PEER_READINESS_V1",
    rows,
    productionImpact: "NONE",
    readOnly: true,
    forwardsDownstream: false,
    affectsDirection: false,
    affectsVerdict: false,
    affectsExecution: false,
    affectsTelegram: false,
    failClosed: true,
  };
}

import {
  calculatePremiumPairDivergence,
  type PpdPairState,
  type PpdSide,
  type PpdWindowResult,
} from "./h1-premium-pair-divergence-v1.js";

export const H1_LIVE_PPD_SUPPORT_VERSION = "H1_LIVE_PPD_SUPPORT_V1" as const;

const REQUIRED_WINDOWS = [3, 6, 15] as const;
const HISTORY_RETENTION_MS = 20 * 60_000;
const WINDOW_TOLERANCE_MS = 90_000;

export interface LivePpdQuoteIdentity {
  symbol: "NIFTY" | "SENSEX" | "BANKNIFTY";
  side: PpdSide;
  strike: number;
  expiryDate: string;
  premiumLtp: number;
  observedAt: string;
  provenance: "LIVE_RUNTIME_EXACT";
}

export interface LivePpdWindowEvidence {
  windowMinutes: 3 | 6 | 15;
  usable: boolean;
  from: string | null;
  to: string;
  controllingSide: PpdSide | null;
  pairState: PpdPairState | null;
  rawPpdPp: number | null;
  candidateOrientedPpdPp: number | null;
  candidateControlledExpansion: boolean;
  reason: string | null;
}

export interface LivePpdSupportEvidence {
  version: typeof H1_LIVE_PPD_SUPPORT_VERSION;
  provenance: "LIVE_RUNTIME_EXACT";
  source: "H1_LIVE_PPD_3M_6M_15M_CONTROLLED_EXPANSION";
  observedAt: string;
  symbol: LivePpdQuoteIdentity["symbol"];
  expiryDate: string;
  strike: number;
  candidateSide: PpdSide;
  allRequiredWindowsReady: boolean;
  candidateConfirmed: boolean;
  windows: LivePpdWindowEvidence[];
  reasonCodes: string[];
  supportingOnly: true;
  standaloneTrigger: false;
  productionImpact: "SELECTOR_SUPPORTING_EVIDENCE";
}

type PairSnapshot = {
  timestamp: string;
  timestampMs: number;
  symbol: LivePpdQuoteIdentity["symbol"];
  expiryDate: string;
  strike: number;
  ce: number | null;
  pe: number | null;
};

const pairHistory = new Map<string, PairSnapshot[]>();

function pairKey(identity: Pick<LivePpdQuoteIdentity, "symbol" | "expiryDate" | "strike">): string {
  return `${identity.symbol}|${identity.expiryDate}|${identity.strike}`;
}

function validIdentity(identity: LivePpdQuoteIdentity): boolean {
  const observedAtMs = Date.parse(identity.observedAt);
  return (identity.symbol === "NIFTY" || identity.symbol === "SENSEX" || identity.symbol === "BANKNIFTY")
    && (identity.side === "CE" || identity.side === "PE")
    && Number.isFinite(identity.strike)
    && identity.strike > 0
    && Number.isFinite(identity.premiumLtp)
    && identity.premiumLtp > 0
    && identity.provenance === "LIVE_RUNTIME_EXACT"
    && Number.isFinite(observedAtMs);
}

function complete(snapshot: PairSnapshot): boolean {
  return typeof snapshot.ce === "number" && snapshot.ce > 0 && typeof snapshot.pe === "number" && snapshot.pe > 0;
}

export function recordH1LivePpdQuote(identity: LivePpdQuoteIdentity): void {
  if (!validIdentity(identity)) return;
  const key = pairKey(identity);
  const observedAtMs = Date.parse(identity.observedAt);
  const history = pairHistory.get(key) ?? [];
  let snapshot = history.find((item) => item.timestampMs === observedAtMs);
  if (!snapshot) {
    snapshot = {
      timestamp: new Date(observedAtMs).toISOString(),
      timestampMs: observedAtMs,
      symbol: identity.symbol,
      expiryDate: identity.expiryDate,
      strike: identity.strike,
      ce: null,
      pe: null,
    };
    history.push(snapshot);
  }
  if (identity.side === "CE") snapshot.ce = identity.premiumLtp;
  else snapshot.pe = identity.premiumLtp;

  const cutoff = observedAtMs - HISTORY_RETENTION_MS;
  const retained = history
    .filter((item) => item.timestampMs >= cutoff)
    .sort((a, b) => a.timestampMs - b.timestampMs);
  pairHistory.set(key, retained);
}

function nearestCompleteSnapshot(history: PairSnapshot[], targetMs: number): PairSnapshot | null {
  let best: PairSnapshot | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const snapshot of history) {
    if (!complete(snapshot)) continue;
    const distance = Math.abs(snapshot.timestampMs - targetMs);
    if (distance <= WINDOW_TOLERANCE_MS && distance < bestDistance) {
      best = snapshot;
      bestDistance = distance;
    }
  }
  return best;
}

function quote(snapshot: PairSnapshot, side: PpdSide) {
  return {
    timestamp: snapshot.timestamp,
    indexSymbol: snapshot.symbol,
    expiry: snapshot.expiryDate,
    strike: snapshot.strike,
    side,
    price: side === "CE" ? snapshot.ce! : snapshot.pe!,
    priceSource: "LAST_FALLBACK" as const,
    quoteAgeMs: 0,
    stale: false,
  };
}

function candidateControlled(result: PpdWindowResult, side: PpdSide): boolean {
  if (!result.ok || result.controllingSide !== side) return false;
  return side === "CE"
    ? result.pairState === "CE_CONTROLLED_EXPANSION"
    : result.pairState === "PE_CONTROLLED_EXPANSION";
}

export function buildH1LivePpdSupport(identity: LivePpdQuoteIdentity): LivePpdSupportEvidence | null {
  if (!validIdentity(identity)) return null;
  const history = pairHistory.get(pairKey(identity)) ?? [];
  const endMs = Date.parse(identity.observedAt);
  const end = history.find((item) => item.timestampMs === endMs && complete(item));
  if (!end) return null;

  const windows: LivePpdWindowEvidence[] = REQUIRED_WINDOWS.map((windowMinutes) => {
    const from = nearestCompleteSnapshot(history, endMs - windowMinutes * 60_000);
    if (!from || from.timestampMs >= end.timestampMs) {
      return {
        windowMinutes,
        usable: false,
        from: from?.timestamp ?? null,
        to: end.timestamp,
        controllingSide: null,
        pairState: null,
        rawPpdPp: null,
        candidateOrientedPpdPp: null,
        candidateControlledExpansion: false,
        reason: `PPD_${windowMinutes}M_WINDOW_UNAVAILABLE`,
      };
    }

    const result = calculatePremiumPairDivergence({
      ceFrom: quote(from, "CE"),
      ceTo: quote(end, "CE"),
      peFrom: quote(from, "PE"),
      peTo: quote(end, "PE"),
    });
    if (!result.ok) {
      return {
        windowMinutes,
        usable: false,
        from: from.timestamp,
        to: end.timestamp,
        controllingSide: null,
        pairState: null,
        rawPpdPp: null,
        candidateOrientedPpdPp: null,
        candidateControlledExpansion: false,
        reason: result.reason,
      };
    }

    const controlled = candidateControlled(result, identity.side);
    return {
      windowMinutes,
      usable: true,
      from: result.from,
      to: result.to,
      controllingSide: result.controllingSide,
      pairState: result.pairState,
      rawPpdPp: result.rawPpdPp,
      candidateOrientedPpdPp: identity.side === "CE" ? result.rawPpdPp : -result.rawPpdPp,
      candidateControlledExpansion: controlled,
      reason: controlled ? null : `PPD_${windowMinutes}M_CANDIDATE_CONTROL_NOT_CONFIRMED`,
    };
  });

  const allRequiredWindowsReady = windows.every((window) => window.usable);
  const candidateConfirmed = allRequiredWindowsReady && windows.every((window) => window.candidateControlledExpansion);
  const reasonCodes = candidateConfirmed
    ? ["PPD_3M_6M_15M_CANDIDATE_CONTROL_CONFIRMED"]
    : windows.filter((window) => window.reason).map((window) => window.reason!)
      .concat(allRequiredWindowsReady ? ["PPD_CONTROL_INCOMPLETE"] : ["PPD_REQUIRED_WINDOWS_INCOMPLETE"]);

  return {
    version: H1_LIVE_PPD_SUPPORT_VERSION,
    provenance: "LIVE_RUNTIME_EXACT",
    source: "H1_LIVE_PPD_3M_6M_15M_CONTROLLED_EXPANSION",
    observedAt: end.timestamp,
    symbol: identity.symbol,
    expiryDate: identity.expiryDate,
    strike: identity.strike,
    candidateSide: identity.side,
    allRequiredWindowsReady,
    candidateConfirmed,
    windows,
    reasonCodes: [...new Set(reasonCodes)],
    supportingOnly: true,
    standaloneTrigger: false,
    productionImpact: "SELECTOR_SUPPORTING_EVIDENCE",
  };
}

export function clearH1LivePpdHistory(): void {
  pairHistory.clear();
}

export function getH1LivePpdPairHistorySize(): number {
  return pairHistory.size;
}

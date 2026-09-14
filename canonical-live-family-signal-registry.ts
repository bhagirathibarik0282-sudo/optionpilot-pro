import type { CanonicalMarketFamily, CanonicalMarketSymbol } from "./canonical-one-roof-market-snapshot.js";
import type { CanonicalDeterministicFamilySignal } from "./canonical-normalized-family-support-producer.js";

export const CANONICAL_LIVE_FAMILY_SIGNAL_REGISTRY_V1 = "CANONICAL_LIVE_FAMILY_SIGNAL_REGISTRY_V1" as const;

export const CANONICAL_BUSINESS_REQUIRED_FAMILIES: readonly CanonicalMarketFamily[] = [
  "MARKET_STRUCTURE",
  "FUTURES_CONFIRMATION",
  "OPTION_PREMIUMS",
  "OI_POSITIONING",
  "MULTI_DTE",
  "VOLATILITY",
  "HEAVYWEIGHTS",
  "SECTOR_BREADTH",
  "RESPONSE_LADDER",
  "LIQUIDITY_EXECUTABILITY",
] as const;

export interface CanonicalLiveFamilySignalEnvelope {
  provenance: "LIVE_DETERMINISTIC_FAMILY_SIGNAL_V1";
  symbol: CanonicalMarketSymbol;
  observedAtMs: number;
  signal: CanonicalDeterministicFamilySignal;
}

export interface CanonicalLiveFamilySignalPublishResult {
  accepted: boolean;
  reason:
    | "LIVE_FAMILY_SIGNAL_ACCEPTED"
    | "INVALID_ENVELOPE"
    | "INVALID_SIGNAL"
    | "NON_FORWARD_SIGNAL_TIMESTAMP";
  family: CanonicalMarketFamily | null;
  failClosed: true;
}

export interface CanonicalLiveFamilySignalCollection {
  version: typeof CANONICAL_LIVE_FAMILY_SIGNAL_REGISTRY_V1;
  ready: boolean;
  symbol: CanonicalMarketSymbol;
  sourceManifestHash: string;
  observedAtMs: number | null;
  signals: CanonicalDeterministicFamilySignal[];
  blockers: string[];
  requiredFamilyCount: 10;
  verifiedFamilyCount: number;
  grantsCandidateAuthority: false;
  sendsTelegram: false;
  createsOrders: false;
  affectsExecution: false;
  aiMayOverride: false;
  failClosed: true;
}

type StoredSignal = {
  envelope: CanonicalLiveFamilySignalEnvelope;
};

function validSignal(signal: CanonicalDeterministicFamilySignal): boolean {
  return Boolean(
    signal
    && CANONICAL_BUSINESS_REQUIRED_FAMILIES.includes(signal.family)
    && (signal.stance === "BUYER_SUPPORT" || signal.stance === "SELLER_SUPPORT" || signal.stance === "BALANCED")
    && Number.isFinite(signal.strength)
    && signal.strength >= 0
    && signal.strength <= 100
    && signal.deterministic === true
    && signal.evidenceReady === true
    && typeof signal.sourceId === "string"
    && signal.sourceId.trim()
    && typeof signal.sourceManifestHash === "string"
    && signal.sourceManifestHash.trim()
    && signal.sourceSemantics === "EXPLICIT_DIRECTIONAL_SUPPORT"
    && signal.grantsDirectionalSupport === true
    && Array.isArray(signal.devilFlags)
    && signal.devilFlags.length === 0
  );
}

export class CanonicalLiveFamilySignalRegistry {
  private readonly bySymbol = new Map<CanonicalMarketSymbol, Map<CanonicalMarketFamily, StoredSignal>>();

  publish(envelope: CanonicalLiveFamilySignalEnvelope): CanonicalLiveFamilySignalPublishResult {
    if (
      envelope?.provenance !== "LIVE_DETERMINISTIC_FAMILY_SIGNAL_V1"
      || !["NIFTY", "SENSEX", "BANKNIFTY"].includes(envelope?.symbol)
      || !Number.isFinite(envelope?.observedAtMs)
      || envelope.observedAtMs <= 0
    ) {
      return { accepted: false, reason: "INVALID_ENVELOPE", family: null, failClosed: true };
    }
    if (!validSignal(envelope.signal)) {
      return { accepted: false, reason: "INVALID_SIGNAL", family: envelope.signal?.family ?? null, failClosed: true };
    }

    const rows = this.bySymbol.get(envelope.symbol) ?? new Map<CanonicalMarketFamily, StoredSignal>();
    const existing = rows.get(envelope.signal.family);
    if (existing && envelope.observedAtMs <= existing.envelope.observedAtMs) {
      return {
        accepted: false,
        reason: "NON_FORWARD_SIGNAL_TIMESTAMP",
        family: envelope.signal.family,
        failClosed: true,
      };
    }

    rows.set(envelope.signal.family, {
      envelope: {
        ...envelope,
        signal: { ...envelope.signal, devilFlags: [...envelope.signal.devilFlags] },
      },
    });
    this.bySymbol.set(envelope.symbol, rows);
    return {
      accepted: true,
      reason: "LIVE_FAMILY_SIGNAL_ACCEPTED",
      family: envelope.signal.family,
      failClosed: true,
    };
  }

  collect(
    symbol: CanonicalMarketSymbol,
    sourceManifestHash: string,
    nowMs: number,
    maxAgeMs = 90_000,
  ): CanonicalLiveFamilySignalCollection {
    const blockers: string[] = [];
    const signals: CanonicalDeterministicFamilySignal[] = [];
    const rows = this.bySymbol.get(symbol);
    const validRequest = (
      ["NIFTY", "SENSEX", "BANKNIFTY"].includes(symbol)
      && typeof sourceManifestHash === "string"
      && sourceManifestHash.trim().length > 0
      && Number.isFinite(nowMs)
      && nowMs > 0
      && Number.isFinite(maxAgeMs)
      && maxAgeMs > 0
    );

    if (!validRequest) blockers.push("INVALID_COLLECTION_REQUEST");

    let newest: number | null = null;
    for (const family of CANONICAL_BUSINESS_REQUIRED_FAMILIES) {
      const stored = rows?.get(family);
      if (!stored) {
        blockers.push(`${family}:LIVE_SIGNAL_MISSING`);
        continue;
      }
      const { envelope } = stored;
      const ageMs = nowMs - envelope.observedAtMs;
      if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > maxAgeMs) {
        blockers.push(`${family}:LIVE_SIGNAL_STALE_OR_FUTURE`);
        continue;
      }
      if (envelope.signal.sourceManifestHash !== sourceManifestHash) {
        blockers.push(`${family}:SOURCE_MANIFEST_MISMATCH`);
        continue;
      }
      if (!validSignal(envelope.signal)) {
        blockers.push(`${family}:LIVE_SIGNAL_INVALID`);
        continue;
      }
      signals.push({ ...envelope.signal, devilFlags: [...envelope.signal.devilFlags] });
      newest = newest == null ? envelope.observedAtMs : Math.max(newest, envelope.observedAtMs);
    }

    const uniqueBlockers = [...new Set(blockers)];
    const ready = validRequest
      && uniqueBlockers.length === 0
      && signals.length === CANONICAL_BUSINESS_REQUIRED_FAMILIES.length;

    return {
      version: CANONICAL_LIVE_FAMILY_SIGNAL_REGISTRY_V1,
      ready,
      symbol,
      sourceManifestHash,
      observedAtMs: ready ? newest : null,
      signals: ready ? signals : [],
      blockers: uniqueBlockers,
      requiredFamilyCount: 10,
      verifiedFamilyCount: signals.length,
      grantsCandidateAuthority: false,
      sendsTelegram: false,
      createsOrders: false,
      affectsExecution: false,
      aiMayOverride: false,
      failClosed: true,
    };
  }

  clear(symbol?: CanonicalMarketSymbol): void {
    if (symbol) {
      this.bySymbol.delete(symbol);
      return;
    }
    this.bySymbol.clear();
  }
}

export const canonicalLiveFamilySignalRegistry = new CanonicalLiveFamilySignalRegistry();

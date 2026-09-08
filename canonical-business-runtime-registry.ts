import type { CanonicalBusinessConsumerResult } from "./canonical-business-consumer.js";

export interface CanonicalBusinessRuntimeRegistryEntry {
  consumer: CanonicalBusinessConsumerResult;
  updatedAtMs: number;
}

export class CanonicalBusinessRuntimeRegistry {
  private readonly bySymbol = new Map<string, CanonicalBusinessRuntimeRegistryEntry>();

  constructor(private readonly maxAgeMs = 60_000, private readonly now: () => number = () => Date.now()) {}

  private normalize(symbol: string): string | null {
    return typeof symbol === "string" && symbol.trim() ? symbol.trim().toUpperCase() : null;
  }

  publish(symbolInput: string, consumer: CanonicalBusinessConsumerResult, updatedAtMs = this.now()): boolean {
    const symbol = this.normalize(symbolInput);
    if (!symbol || !Number.isFinite(updatedAtMs) || updatedAtMs <= 0) return false;
    if (!consumer || consumer.version !== "CANONICAL_BUSINESS_CONSUMER_V1") return false;
    if (!consumer.candidateKey || !consumer.buyerCandidate) return false;
    const candidate = consumer.buyerCandidate;
    if (consumer.candidateKey !== candidate.candidateKey) return false;
    if (candidate.symbol !== symbol) return false;
    if (candidate.role !== "OPTION_BUYER" || candidate.sourceAuthority !== "EXECUTION_CANDIDATE_SELECTOR_V2") return false;
    if (candidate.optionSide !== "CE" && candidate.optionSide !== "PE") return false;
    if (!Number.isFinite(candidate.strike) || !Number.isInteger(candidate.dte) || candidate.dte < 0) return false;
    const expectedCandidateKey = `${candidate.symbol}:${candidate.optionSide}:${candidate.strike}:${candidate.expiryDate}:DTE${candidate.dte}:${candidate.moneyness}`;
    if (candidate.candidateKey !== expectedCandidateKey) return false;
    if (!Array.isArray(consumer.horizons)) return false;
    const horizons = new Set(consumer.horizons.map((entry) => entry.horizon));
    const requiredHorizons = ["INTRADAY", "MULTIDAY", "EXPIRY"] as const;
    if (consumer.horizons.length !== 3 || horizons.size !== 3 || !requiredHorizons.every((value) => horizons.has(value))) return false;
    if (consumer.sameCanonicalCandidateForDashboardAndTelegram !== true) return false;
    if (consumer.affectsExecution !== false || consumer.createsOrders !== false || consumer.aiMayOverride !== false) return false;
    this.bySymbol.set(symbol, { consumer, updatedAtMs });
    return true;
  }

  read(symbolInput: string): CanonicalBusinessConsumerResult | null {
    const symbol = this.normalize(symbolInput);
    if (!symbol) return null;
    const entry = this.bySymbol.get(symbol);
    if (!entry) return null;
    const age = this.now() - entry.updatedAtMs;
    if (!Number.isFinite(age) || age < 0 || age > this.maxAgeMs) return null;
    return entry.consumer;
  }

  clear(symbolInput?: string): void {
    if (symbolInput == null) {
      this.bySymbol.clear();
      return;
    }
    const symbol = this.normalize(symbolInput);
    if (symbol) this.bySymbol.delete(symbol);
  }
}

export const canonicalBusinessRuntimeRegistry = new CanonicalBusinessRuntimeRegistry();

import type { OptionBuyingRuntimeRiskProvider, OptionBuyingRuntimeRiskState } from "./option-buying-runtime-risk-bridge.js";

export interface OptionBuyingRuntimeRiskRegistryEntry extends OptionBuyingRuntimeRiskState {
  updatedAtMs: number;
}

export class OptionBuyingRuntimeRiskRegistry implements OptionBuyingRuntimeRiskProvider {
  private readonly bySymbol = new Map<string, OptionBuyingRuntimeRiskRegistryEntry>();

  constructor(private readonly maxAgeMs = 60_000, private readonly now: () => number = () => Date.now()) {}

  private normalize(symbol: string): string | null {
    return typeof symbol === "string" && symbol.trim() ? symbol.trim().toUpperCase() : null;
  }

  set(symbolInput: string, state: OptionBuyingRuntimeRiskState, updatedAtMs = this.now()): boolean {
    const symbol = this.normalize(symbolInput);
    if (!symbol || !Number.isFinite(updatedAtMs) || updatedAtMs <= 0) return false;
    this.bySymbol.set(symbol, { ...state, updatedAtMs });
    return true;
  }

  read(symbolInput: string): OptionBuyingRuntimeRiskState | null {
    const symbol = this.normalize(symbolInput);
    if (!symbol) return null;
    const entry = this.bySymbol.get(symbol);
    if (!entry) return null;
    const age = this.now() - entry.updatedAtMs;
    if (!Number.isFinite(age) || age < 0 || age > this.maxAgeMs) return null;
    return {
      dynamicDailyLoss: entry.dynamicDailyLoss,
      realisedLossToday: entry.realisedLossToday,
      openRisk: entry.openRisk,
      estimatedExistingCosts: entry.estimatedExistingCosts,
    };
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

import type { RecorderSymbol } from "./option-recorder-shadow.js";

export type KiteImmediateInstrumentRole = "SPOT" | "FUTURE" | "OPTION" | "INDIA_VIX";
export type KiteImmediateOptionSide = "CE" | "PE" | null;

export type KiteImmediateTokenEntry = {
  instrumentToken: number;
  symbol: RecorderSymbol;
  role: KiteImmediateInstrumentRole;
  instrumentLabel: string;
  expiry?: string | null;
  strike?: number | null;
  optionSide?: KiteImmediateOptionSide;
};

export class KiteImmediateTokenRegistry {
  private readonly byToken = new Map<number, KiteImmediateTokenEntry>();

  constructor(entries: KiteImmediateTokenEntry[]) {
    if (!Array.isArray(entries) || entries.length === 0) throw new Error("KITE_IMMEDIATE_REGISTRY_EMPTY");
    if (entries.length > 3000) throw new Error("KITE_IMMEDIATE_REGISTRY_TOKEN_LIMIT_EXCEEDED");

    for (const raw of entries) {
      const entry = { ...raw, instrumentLabel: raw.instrumentLabel?.trim() };
      if (!Number.isInteger(entry.instrumentToken) || entry.instrumentToken <= 0) throw new Error("KITE_IMMEDIATE_REGISTRY_INVALID_TOKEN");
      if (!entry.instrumentLabel) throw new Error("KITE_IMMEDIATE_REGISTRY_LABEL_REQUIRED");
      if (this.byToken.has(entry.instrumentToken)) throw new Error("KITE_IMMEDIATE_REGISTRY_DUPLICATE_TOKEN");
      if (entry.role === "OPTION") {
        if (entry.optionSide !== "CE" && entry.optionSide !== "PE") throw new Error("KITE_IMMEDIATE_REGISTRY_OPTION_SIDE_REQUIRED");
        if (!entry.expiry || !Number.isFinite(entry.strike) || Number(entry.strike) <= 0) throw new Error("KITE_IMMEDIATE_REGISTRY_OPTION_IDENTITY_REQUIRED");
      } else if (entry.optionSide != null) {
        throw new Error("KITE_IMMEDIATE_REGISTRY_NON_OPTION_SIDE_FORBIDDEN");
      }
      this.byToken.set(entry.instrumentToken, entry as KiteImmediateTokenEntry);
    }
  }

  get(instrumentToken: number): KiteImmediateTokenEntry | null {
    return this.byToken.get(instrumentToken) ?? null;
  }

  tokens(): number[] {
    return [...this.byToken.keys()];
  }

  coveredSymbols(): RecorderSymbol[] {
    return [...new Set([...this.byToken.values()].map((x) => x.symbol))];
  }

  entries(): KiteImmediateTokenEntry[] {
    return [...this.byToken.values()];
  }
}

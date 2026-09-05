import type { KiteInstrumentMasterRow } from "./kite-immediate-registry-builder.js";
import type { H1ForwardCandidateDecisionInput } from "./h1-forward-candidate-decision-binding.js";

export interface H1LockedCandidateInstrumentIdentity {
  instrumentToken: number;
  tradingSymbol: string;
  source: "KITE_INSTRUMENT_MASTER_EXACT";
}

function symbolMatches(row: KiteInstrumentMasterRow, symbol: string): boolean {
  const name = String(row.name ?? "").trim().toUpperCase();
  const ts = String(row.tradingsymbol ?? "").trim().toUpperCase();
  if (symbol === "NIFTY") return (name === "NIFTY" || ts.startsWith("NIFTY")) && !ts.startsWith("BANKNIFTY") && !ts.startsWith("FINNIFTY");
  return name === symbol || ts.startsWith(symbol);
}

export function resolveH1LockedCandidateInstrument(
  rows: KiteInstrumentMasterRow[],
  decision: H1ForwardCandidateDecisionInput,
): H1LockedCandidateInstrumentIdentity {
  if (!Array.isArray(rows) || rows.length === 0) throw new Error("KITE_INSTRUMENT_MASTER_REQUIRED");
  if (decision.decision !== "SELECT") throw new Error("SELECT_DECISION_REQUIRED");

  const matches = rows.filter((row) => symbolMatches(row, decision.symbol)
    && String(row.expiry ?? "") === decision.expiry
    && Number(row.strike) === decision.strike
    && String(row.instrument_type ?? "").trim().toUpperCase() === decision.side
    && Number.isInteger(row.instrument_token)
    && row.instrument_token > 0
    && String(row.tradingsymbol ?? "").trim().length > 0);

  if (matches.length !== 1) {
    throw new Error(`KITE_OPTION_IDENTITY_NOT_UNIQUE:${decision.symbol}:${decision.expiry}:${decision.strike}:${decision.side}:${matches.length}`);
  }

  return Object.freeze({
    instrumentToken: matches[0].instrument_token,
    tradingSymbol: matches[0].tradingsymbol.trim(),
    source: "KITE_INSTRUMENT_MASTER_EXACT" as const,
  });
}

import { resolveKiteAuthoritySession } from "./kite-session-authority.js";
import { fetchH1KiteLiveInstrumentMaster } from "./h1-kite-live-instrument-master-adapter.js";
import { discoverH1ExactLiveContractUniverse } from "./h1-exact-live-contract-discovery.js";
import type { RecorderSymbol } from "./option-recorder-shadow.js";

const ALLOWED = ["NIFTY", "SENSEX", "BANKNIFTY"] as const;

export interface H1ExactLiveContractDiscoveryHttpInput {
  symbols: string | null | undefined;
  asOfDate: string | null | undefined;
}

export async function runH1ExactLiveContractDiscoveryHttp(
  input: H1ExactLiveContractDiscoveryHttpInput,
) {
  const asOfDate = String(input.asOfDate ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOfDate)) {
    return { ok: false, mode: "READ_ONLY_H1_EXACT_LIVE_CONTRACT_DISCOVERY_V1", productionImpact: "NONE", blockers: ["DISCOVERY_AS_OF_DATE_INVALID"], rows: [] };
  }

  const raw = String(input.symbols ?? "NIFTY,SENSEX,BANKNIFTY")
    .split(",")
    .map((x) => x.trim().toUpperCase())
    .filter(Boolean);
  const symbols = [...new Set(raw)] as RecorderSymbol[];
  if (symbols.length === 0 || symbols.some((s) => !(ALLOWED as readonly string[]).includes(s))) {
    return { ok: false, mode: "READ_ONLY_H1_EXACT_LIVE_CONTRACT_DISCOVERY_V1", productionImpact: "NONE", blockers: ["DISCOVERY_SYMBOL_INVALID"], rows: [] };
  }

  const apiKey = process.env.KITE_API_KEY?.trim() ?? "";
  if (!apiKey) {
    return { ok: false, mode: "READ_ONLY_H1_EXACT_LIVE_CONTRACT_DISCOVERY_V1", productionImpact: "NONE", blockers: ["KITE_API_KEY_MISSING"], rows: [] };
  }

  const authority = await resolveKiteAuthoritySession();
  if (!authority.session || !authority.status.active) {
    return { ok: false, mode: "READ_ONLY_H1_EXACT_LIVE_CONTRACT_DISCOVERY_V1", productionImpact: "NONE", blockers: [`KITE_AUTHORITY_${authority.status.code}`], rows: [] };
  }

  const master = await fetchH1KiteLiveInstrumentMaster({ apiKey, accessToken: authority.session.accessToken });
  if (!master.ready) {
    return { ok: false, mode: "READ_ONLY_H1_EXACT_LIVE_CONTRACT_DISCOVERY_V1", productionImpact: "NONE", blockers: master.blockers, rows: [] };
  }

  const discovered = discoverH1ExactLiveContractUniverse(master.rows, { symbols, asOfDate });
  return {
    ok: discovered.ready,
    mode: "READ_ONLY_H1_EXACT_LIVE_CONTRACT_DISCOVERY_V1",
    productionImpact: "NONE",
    source: discovered.source,
    rows: discovered.rows,
    blockers: discovered.blockers,
    choosesAtm: false,
    inferredTokens: false,
    credentialsExposed: false,
    writesRailwayVariables: false,
    activatesShadow: false,
    affectsVerdict: false,
    affectsExecution: false,
  };
}

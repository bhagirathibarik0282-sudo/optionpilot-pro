import { buildBusinessHorizonView, type BusinessHorizonView } from "./business-buyer-seller-layer.js";
import { canonicalBusinessRuntimeRegistry } from "./canonical-business-runtime-registry.js";
import { collectH1LiveSelectorDecisions } from "./h1-live-selector-registry.js";

export const BUSINESS_DASHBOARD_V1 = "BUSINESS_DASHBOARD_V1" as const;
export type BusinessDashboardSymbol = "NIFTY" | "SENSEX";

export interface BusinessDashboardV1Model {
  version: typeof BUSINESS_DASHBOARD_V1;
  symbol: BusinessDashboardSymbol;
  ready: boolean;
  state: "CANDIDATE_READY" | "WAIT";
  headline: string;
  candidate: ReturnType<typeof canonicalBusinessRuntimeRegistry.read> extends infer T
    ? T extends { buyerCandidate: infer C } ? C : never
    : never;
  horizons: BusinessHorizonView[];
  selector: {
    selectCount: number;
    blockCount: number;
    reasonCodes: string[];
  };
  sameCanonicalCandidateForDashboardAndTelegram: true;
  readOnly: true;
  affectsVerdict: false;
  affectsCandidateAuthority: false;
  affectsTelegram: false;
  affectsExecution: false;
  createsOrders: false;
}

const HORIZONS = ["INTRADAY","MULTIDAY","EXPIRY"] as const;

export function buildBusinessDashboardV1(symbol: BusinessDashboardSymbol, nowIso = new Date().toISOString()): BusinessDashboardV1Model {
  const consumer = canonicalBusinessRuntimeRegistry.read(symbol);
  const selector = collectH1LiveSelectorDecisions(nowIso);
  const symbolDecisions = selector.decisions.filter((d) => d.symbol === symbol);
  const selects = symbolDecisions.filter((d) => d.decision === "SELECT");
  const blocks = symbolDecisions.filter((d) => d.decision === "BLOCK");
  const reasonCodes = [...new Set(blocks.flatMap((d) => d.reasonCodes ?? []))];

  const horizons = consumer?.horizons?.length === 3
    ? consumer.horizons
    : HORIZONS.map((horizon) => buildBusinessHorizonView({
        horizon,
        buyerScore: null,
        sellerScore: null,
        evidenceReady: false,
        reasons: selects.length === 0 ? ["No eligible live selector candidate"] : ["Business evidence not yet published"],
      }));

  const candidate = consumer?.buyerCandidate ?? null;
  const ready = Boolean(candidate && consumer?.sameCanonicalCandidateForDashboardAndTelegram === true);
  return {
    version: BUSINESS_DASHBOARD_V1,
    symbol,
    ready,
    state: ready ? "CANDIDATE_READY" : "WAIT",
    headline: ready ? "Buyer candidate ready" : "Wait — no verified buyer edge yet",
    candidate,
    horizons,
    selector: {
      selectCount: selects.length,
      blockCount: blocks.length,
      reasonCodes,
    },
    sameCanonicalCandidateForDashboardAndTelegram: true,
    readOnly: true,
    affectsVerdict: false,
    affectsCandidateAuthority: false,
    affectsTelegram: false,
    affectsExecution: false,
    createsOrders: false,
  };
}

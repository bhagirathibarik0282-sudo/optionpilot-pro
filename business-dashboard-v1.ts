import { buildBusinessHorizonView, type BusinessHorizonView } from "./business-buyer-seller-layer.js";
import { canonicalBusinessRuntimeRegistry } from "./canonical-business-runtime-registry.js";
import type { CanonicalBuyerDashboardCandidate } from "./canonical-business-consumer.js";
import { collectH1LiveSelectorDecisions } from "./h1-live-selector-registry.js";

export const BUSINESS_DASHBOARD_V1 = "BUSINESS_DASHBOARD_V1" as const;
export type BusinessDashboardSymbol = "NIFTY" | "SENSEX";

export interface BusinessDashboardV1Model {
  version: typeof BUSINESS_DASHBOARD_V1;
  symbol: BusinessDashboardSymbol;
  ready: boolean;
  state: "CANDIDATE_READY" | "WAIT";
  headline: string;
  candidate: CanonicalBuyerDashboardCandidate | null;
  horizons: BusinessHorizonView[];
  selector: {
    selectCount: number;
    blockCount: number;
    reasonCodes: string[];
  };
  intelligence: Array<{
    key: "SMC_CANDLE" | "FUTURES" | "PREMIUM_REALITY" | "OI_PCR_WALLS" | "MULTI_DTE" | "IV_SKEW" | "MARKET_DNA" | "HEAVYWEIGHTS_SECTORS" | "LIQUIDITY";
    label: string;
    state: "VERIFIED" | "WAIT";
    detail: string;
  }>;
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
  const familyReady = ready && consumer?.horizons?.length === 3 && consumer.horizons.every((h) => h.devilCheck === "PASS");
  const intelligence: BusinessDashboardV1Model["intelligence"] = [
    { key:"SMC_CANDLE", label:"SMC + Candle Context", state:familyReady ? "VERIFIED" : "WAIT", detail:familyReady ? "Interpretation context verified with canonical business evidence" : "Waiting for verified canonical business evidence" },
    { key:"FUTURES", label:"Futures", state:familyReady ? "VERIFIED" : "WAIT", detail:familyReady ? "Futures confirmation included in canonical business evidence" : "Waiting for verified futures confirmation" },
    { key:"PREMIUM_REALITY", label:"CE/PE Premium Reality", state:selects.length > 0 ? "VERIFIED" : "WAIT", detail:selects.length > 0 ? "Exact live premium response passed selector gates" : "No exact live premium response confirmation yet" },
    { key:"OI_PCR_WALLS", label:"OI / PCR / Wall Migration", state:familyReady ? "VERIFIED" : "WAIT", detail:familyReady ? "Positioning family included in canonical business evidence" : "Waiting for verified positioning evidence" },
    { key:"MULTI_DTE", label:"Multi-DTE", state:familyReady ? "VERIFIED" : "WAIT", detail:familyReady ? "Multi-DTE family included in canonical business evidence" : "Waiting for verified multi-DTE evidence" },
    { key:"IV_SKEW", label:"IV / Skew", state:familyReady ? "VERIFIED" : "WAIT", detail:familyReady ? "Volatility family included in canonical business evidence" : "Waiting for verified volatility evidence" },
    { key:"MARKET_DNA", label:"Market DNA", state:"WAIT", detail:"Context-only layer; never counted as an extra vote" },
    { key:"HEAVYWEIGHTS_SECTORS", label:"Heavyweights / Sectors", state:familyReady ? "VERIFIED" : "WAIT", detail:familyReady ? "Heavyweight and sector families included in canonical business evidence" : "Waiting for verified heavyweight/sector evidence" },
    { key:"LIQUIDITY", label:"Liquidity / Executability", state:selects.length > 0 ? "VERIFIED" : "WAIT", detail:selects.length > 0 ? "Live selector passed execution-quality gates" : "No live contract has passed all selector gates yet" },
  ];
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
    intelligence,
    sameCanonicalCandidateForDashboardAndTelegram: true,
    readOnly: true,
    affectsVerdict: false,
    affectsCandidateAuthority: false,
    affectsTelegram: false,
    affectsExecution: false,
    createsOrders: false,
  };
}

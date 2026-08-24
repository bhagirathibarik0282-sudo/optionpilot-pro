import {
  deriveMeaningfulCombinations,
  type MeaningfulCombinationResult,
  type CombinationState,
  type EvidenceBias,
} from "./meaningful-combination-engine.js";

export type EvidenceFamilyId =
  | "PRICE_STRUCTURE"
  | "OPTION_PREMIUM_REALITY"
  | "VOLATILITY_GREEKS"
  | "POSITIONING"
  | "MULTI_EXPIRY"
  | "BREADTH_REGIME";

export type FamilyState = "SUPPORTIVE" | "NEUTRAL" | "CONFLICTING" | "WARNING" | "UNAVAILABLE";
export type FamilyBias = "BULLISH" | "BEARISH" | "MIXED" | "NONE" | "UNKNOWN";

export interface EvidenceFamilyResult {
  id: EvidenceFamilyId;
  name: string;
  state: FamilyState;
  bias: FamilyBias;
  combinationIds: string[];
  availableMembers: number;
  reasons: string[];
  duplicateVoteGuard: true;
  semantics: "FORWARD_TESTING_EVIDENCE_ONLY";
}

export interface EvidenceFamilySnapshot {
  symbol: "NIFTY" | "BANKNIFTY" | "SENSEX";
  minuteBucket: string | null;
  families: EvidenceFamilyResult[];
  availableFamilyCount: number;
  warningFamilyCount: number;
  conflictFamilyCount: number;
  bullishFamilyCount: number;
  bearishFamilyCount: number;
  ruleVersion: "TEF_EVIDENCE_FAMILY_V1";
  affectsVerdict: false;
  affectsTelegram: false;
  affectsExecution: false;
  note: "Families are correlation guards, not independent weighted votes.";
}

type FamilyDefinition = {
  id: EvidenceFamilyId;
  name: string;
  members: string[];
};

const DEFINITIONS: FamilyDefinition[] = [
  {
    id: "PRICE_STRUCTURE",
    name: "Price Structure + Futures + Level Confirmation",
    members: ["COMB-01", "COMB-06"],
  },
  {
    id: "OPTION_PREMIUM_REALITY",
    name: "Option Premium Reality",
    members: ["COMB-02"],
  },
  {
    id: "VOLATILITY_GREEKS",
    name: "Volatility + Greeks + Decay Quality",
    members: ["COMB-03"],
  },
  {
    id: "POSITIONING",
    name: "OI + Walls + PCR Positioning",
    members: ["COMB-04", "COMB-05"],
  },
  {
    id: "MULTI_EXPIRY",
    name: "Multi-expiry Alignment",
    members: ["COMB-07"],
  },
  {
    id: "BREADTH_REGIME",
    name: "Cross-index Breadth / Regime Context",
    members: ["COMB-08"],
  },
];

function familyState(members: MeaningfulCombinationResult[]): FamilyState {
  const usable = members.filter((m) => m.state !== "UNAVAILABLE");
  if (usable.length === 0) return "UNAVAILABLE";
  if (usable.some((m) => m.state === "CONFLICTING")) return "CONFLICTING";
  if (usable.some((m) => m.state === "WARNING")) return "WARNING";
  if (usable.some((m) => m.state === "SUPPORTIVE")) return "SUPPORTIVE";
  return "NEUTRAL";
}

function familyBias(members: MeaningfulCombinationResult[]): FamilyBias {
  const usableBias = members
    .filter((m) => m.state !== "UNAVAILABLE")
    .map((m) => m.bias)
    .filter((b): b is EvidenceBias => b !== "UNKNOWN" && b !== "NONE");

  if (usableBias.length === 0) return "NONE";
  const bullish = usableBias.some((b) => b === "BULLISH");
  const bearish = usableBias.some((b) => b === "BEARISH");
  const mixed = usableBias.some((b) => b === "MIXED");
  if (mixed || (bullish && bearish)) return "MIXED";
  if (bullish) return "BULLISH";
  if (bearish) return "BEARISH";
  return "NONE";
}

function summarizeReasons(members: MeaningfulCombinationResult[]): string[] {
  const reasons: string[] = [];
  for (const member of members) {
    for (const reason of member.reasons) {
      reasons.push(`${member.id}: ${reason}`);
      if (reasons.length >= 6) return reasons;
    }
  }
  return reasons;
}

function buildFamily(
  definition: FamilyDefinition,
  allCombinations: MeaningfulCombinationResult[],
): EvidenceFamilyResult {
  const members = allCombinations.filter((c) => definition.members.includes(c.id));
  const availableMembers = members.filter((m) => m.state !== "UNAVAILABLE").length;
  return {
    id: definition.id,
    name: definition.name,
    state: familyState(members),
    bias: familyBias(members),
    combinationIds: members.map((m) => m.id),
    availableMembers,
    reasons: summarizeReasons(members),
    duplicateVoteGuard: true,
    semantics: "FORWARD_TESTING_EVIDENCE_ONLY",
  };
}

/**
 * Correlation guard only.
 *
 * Multiple related combinations are collapsed into one family state so that
 * correlated observations cannot accidentally become multiple independent
 * votes. This layer deliberately does not score, rank, select a candidate,
 * create a BUY/SELL verdict, send Telegram, or affect execution.
 */
export async function deriveEvidenceFamilies(
  symbol: "NIFTY" | "BANKNIFTY" | "SENSEX",
): Promise<EvidenceFamilySnapshot> {
  const combinations = await deriveMeaningfulCombinations(symbol);
  const families = DEFINITIONS.map((definition) => buildFamily(definition, combinations.combinations));

  return {
    symbol,
    minuteBucket: combinations.minuteBucket,
    families,
    availableFamilyCount: families.filter((f) => f.state !== "UNAVAILABLE").length,
    warningFamilyCount: families.filter((f) => f.state === "WARNING").length,
    conflictFamilyCount: families.filter((f) => f.state === "CONFLICTING").length,
    bullishFamilyCount: families.filter((f) => f.bias === "BULLISH").length,
    bearishFamilyCount: families.filter((f) => f.bias === "BEARISH").length,
    ruleVersion: "TEF_EVIDENCE_FAMILY_V1",
    affectsVerdict: false,
    affectsTelegram: false,
    affectsExecution: false,
    note: "Families are correlation guards, not independent weighted votes.",
  };
}

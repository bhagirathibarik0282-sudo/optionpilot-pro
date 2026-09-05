export const CANONICAL_ONE_ROOF_MARKET_SNAPSHOT_V1 = "CANONICAL_ONE_ROOF_MARKET_SNAPSHOT_V1" as const;

export type CanonicalMarketSymbol = "NIFTY" | "SENSEX" | "BANKNIFTY";

export type CanonicalMarketFamily =
  | "MARKET_STRUCTURE"
  | "FUTURES_CONFIRMATION"
  | "OPTION_PREMIUMS"
  | "OI_POSITIONING"
  | "MULTI_DTE"
  | "VOLATILITY"
  | "HEAVYWEIGHTS"
  | "SECTOR_BREADTH"
  | "RESPONSE_LADDER"
  | "LIQUIDITY_EXECUTABILITY";

export type CanonicalComponentStatus = "VERIFIED" | "PENDING" | "BLOCKED";

export interface CanonicalMarketComponent<T = unknown> {
  family: CanonicalMarketFamily;
  status: CanonicalComponentStatus;
  observedAtMs: number;
  source: string;
  payload: T;
  devilFlags?: string[];
}

export interface CanonicalOneRoofMarketSnapshotInput {
  snapshotId: string;
  symbol: CanonicalMarketSymbol;
  asOfMs: number;
  minuteClosed: boolean;
  components: CanonicalMarketComponent[];
  maxComponentAgeMs?: number;
}

export interface CanonicalOneRoofMarketSnapshot {
  version: typeof CANONICAL_ONE_ROOF_MARKET_SNAPSHOT_V1;
  snapshotId: string;
  symbol: CanonicalMarketSymbol;
  asOfMs: number;
  minuteClosed: boolean;
  immutableRecord: boolean;
  recordable: boolean;
  readyForStrictFiltering: boolean;
  userFacingState: "READY_FOR_BUYER_SELLER_FILTER" | "WAIT_FOR_CONFIRMATION";
  components: CanonicalMarketComponent[];
  internalBlockers: string[];
  failClosed: true;
  createsOrders: false;
  affectsExecution: false;
  aiMayOverride: false;
}

const REQUIRED_FAMILIES: CanonicalMarketFamily[] = [
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
];

function uniq(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

/**
 * One-roof envelope only: it does not calculate, rank, infer direction or select a candidate.
 * It keeps all already-produced market evidence under one snapshot identity and separates:
 * 1) recordability of what the system actually saw, from
 * 2) readiness for strict Buyer/Seller filtering.
 */
export function buildCanonicalOneRoofMarketSnapshot(
  input: CanonicalOneRoofMarketSnapshotInput,
): CanonicalOneRoofMarketSnapshot {
  const blockers: string[] = [];
  const snapshotId = typeof input?.snapshotId === "string" ? input.snapshotId.trim() : "";
  const validAsOf = Number.isFinite(input?.asOfMs) && input.asOfMs > 0;
  const maxAgeMs = Number.isFinite(input?.maxComponentAgeMs) && (input.maxComponentAgeMs ?? 0) > 0
    ? input.maxComponentAgeMs!
    : 90_000;

  if (!snapshotId) blockers.push("SNAPSHOT_ID_REQUIRED");
  if (!validAsOf) blockers.push("INVALID_SNAPSHOT_TIMESTAMP");
  if (!Array.isArray(input?.components)) blockers.push("COMPONENT_ARRAY_REQUIRED");

  const components = Array.isArray(input?.components) ? input.components : [];

  for (const family of REQUIRED_FAMILIES) {
    const rows = components.filter((component) => component?.family === family);
    if (rows.length !== 1) {
      blockers.push(`${family}:${rows.length === 0 ? "MISSING" : "DUPLICATE"}`);
      continue;
    }
    const component = rows[0];
    if (component.status !== "VERIFIED") blockers.push(`${family}:NOT_VERIFIED`);
    if (typeof component.source !== "string" || !component.source.trim()) blockers.push(`${family}:SOURCE_REQUIRED`);
    if (!Number.isFinite(component.observedAtMs) || component.observedAtMs <= 0 || !validAsOf) {
      blockers.push(`${family}:INVALID_TIMESTAMP`);
    } else {
      const age = input.asOfMs - component.observedAtMs;
      if (!Number.isFinite(age) || age < 0 || age > maxAgeMs) blockers.push(`${family}:OUTSIDE_SNAPSHOT_WINDOW`);
    }
    if ((component.devilFlags ?? []).length > 0) blockers.push(`${family}:DEVIL_CHECK_BLOCKED`);
  }

  const unsupported = components.filter((component) => !REQUIRED_FAMILIES.includes(component.family));
  if (unsupported.length > 0) blockers.push("UNSUPPORTED_COMPONENT_FAMILY");

  const uniqueBlockers = uniq(blockers);
  const recordable = Boolean(snapshotId && validAsOf);
  const readyForStrictFiltering = recordable && uniqueBlockers.length === 0;

  return {
    version: CANONICAL_ONE_ROOF_MARKET_SNAPSHOT_V1,
    snapshotId,
    symbol: input.symbol,
    asOfMs: input.asOfMs,
    minuteClosed: input.minuteClosed === true,
    immutableRecord: input.minuteClosed === true && recordable,
    recordable,
    readyForStrictFiltering,
    userFacingState: readyForStrictFiltering ? "READY_FOR_BUYER_SELLER_FILTER" : "WAIT_FOR_CONFIRMATION",
    components,
    internalBlockers: uniqueBlockers,
    failClosed: true,
    createsOrders: false,
    affectsExecution: false,
    aiMayOverride: false,
  };
}

import type {
  CanonicalMarketComponent,
  CanonicalMarketFamily,
  CanonicalMarketSymbol,
} from "./canonical-one-roof-market-snapshot.js";
import type {
  CanonicalConstituentRole,
  CanonicalConstituentTokenEntry,
} from "./canonical-constituent-token-registry.js";

export interface CanonicalConstituentTick {
  instrumentToken: number;
  exchangeTimestampMs: number;
  receivedAtMs: number;
  processedAtMs: number;
  ingestSeq: number;
  ltp: number;
}

export interface CanonicalConstituentLivePayloadRow {
  instrumentToken: number;
  tradingsymbol: string;
  sector: string | null;
  weight: number | null;
  ltp: number | null;
  exchangeTimestampMs: number | null;
  ingestSeq: number | null;
  state: "VERIFIED" | "MISSING" | "DUPLICATE" | "INVALID" | "STALE";
}

export interface CanonicalConstituentLivePayload {
  parentSymbol: CanonicalMarketSymbol;
  role: CanonicalConstituentRole;
  expectedCount: number;
  verifiedCount: number;
  rows: CanonicalConstituentLivePayloadRow[];
  readOnly: true;
  affectsVerdict: false;
  affectsExecution: false;
  affectsTelegram: false;
  grantsCandidateAuthority: false;
}

function familyFor(role: CanonicalConstituentRole): CanonicalMarketFamily {
  return role === "HEAVYWEIGHT" ? "HEAVYWEIGHTS" : "SECTOR_BREADTH";
}

function positiveFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * Converts already-authorized constituent subscriptions plus their live Kite ticks into
 * one canonical component. It never infers membership, sector, weight, direction or candidate.
 * Every expected constituent must have exactly one valid, fresh tick or the component is BLOCKED.
 */
export function buildCanonicalConstituentLiveComponent(input: {
  parentSymbol: CanonicalMarketSymbol;
  role: CanonicalConstituentRole;
  registry: CanonicalConstituentTokenEntry[];
  ticks: CanonicalConstituentTick[];
  asOfMs: number;
  maxTickAgeMs: number;
  source?: string;
}): CanonicalMarketComponent<CanonicalConstituentLivePayload> {
  const expected = input.registry.filter((entry) => entry.parentSymbol === input.parentSymbol && entry.role === input.role);
  const devilFlags: string[] = [];
  if (expected.length === 0) devilFlags.push("CONSTITUENT_REGISTRY_EMPTY");
  if (!positiveFinite(input.asOfMs)) devilFlags.push("INVALID_AS_OF");
  if (!positiveFinite(input.maxTickAgeMs)) devilFlags.push("INVALID_TICK_FRESHNESS_BUDGET");

  const rows: CanonicalConstituentLivePayloadRow[] = expected.map((entry) => {
    const matches = input.ticks.filter((tick) => tick.instrumentToken === entry.instrumentToken);
    if (matches.length === 0) {
      devilFlags.push(`MISSING_TICK:${entry.instrumentToken}`);
      return { ...entry, ltp: null, exchangeTimestampMs: null, ingestSeq: null, state: "MISSING" };
    }
    if (matches.length !== 1) {
      devilFlags.push(`DUPLICATE_TICK:${entry.instrumentToken}`);
      return { ...entry, ltp: null, exchangeTimestampMs: null, ingestSeq: null, state: "DUPLICATE" };
    }

    const tick = matches[0];
    const valid = Number.isInteger(tick.instrumentToken)
      && positiveFinite(tick.exchangeTimestampMs)
      && positiveFinite(tick.receivedAtMs)
      && positiveFinite(tick.processedAtMs)
      && tick.processedAtMs >= tick.receivedAtMs
      && Number.isInteger(tick.ingestSeq)
      && tick.ingestSeq > 0
      && positiveFinite(tick.ltp);
    if (!valid) {
      devilFlags.push(`INVALID_TICK:${entry.instrumentToken}`);
      return { ...entry, ltp: null, exchangeTimestampMs: tick.exchangeTimestampMs ?? null, ingestSeq: tick.ingestSeq ?? null, state: "INVALID" };
    }

    const ageMs = input.asOfMs - tick.exchangeTimestampMs;
    if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > input.maxTickAgeMs) {
      devilFlags.push(`STALE_TICK:${entry.instrumentToken}`);
      return { ...entry, ltp: tick.ltp, exchangeTimestampMs: tick.exchangeTimestampMs, ingestSeq: tick.ingestSeq, state: "STALE" };
    }

    return { ...entry, ltp: tick.ltp, exchangeTimestampMs: tick.exchangeTimestampMs, ingestSeq: tick.ingestSeq, state: "VERIFIED" };
  });

  const verifiedRows = rows.filter((row) => row.state === "VERIFIED");
  const status = devilFlags.length === 0 && expected.length > 0 && verifiedRows.length === expected.length
    ? "VERIFIED" as const
    : "BLOCKED" as const;

  const validTicks = input.ticks.filter((tick) => expected.some((entry) => entry.instrumentToken === tick.instrumentToken));
  const exchangeTimestampMs = validTicks.length > 0
    ? Math.min(...validTicks.map((tick) => positiveFinite(tick.exchangeTimestampMs) ? tick.exchangeTimestampMs : input.asOfMs))
    : input.asOfMs;
  const receivedAtMs = validTicks.length > 0
    ? Math.max(...validTicks.map((tick) => positiveFinite(tick.receivedAtMs) ? tick.receivedAtMs : input.asOfMs))
    : input.asOfMs;
  const processedAtMs = validTicks.length > 0
    ? Math.max(...validTicks.map((tick) => positiveFinite(tick.processedAtMs) ? tick.processedAtMs : input.asOfMs))
    : input.asOfMs;
  const ingestSeq = validTicks.length > 0
    ? Math.max(...validTicks.map((tick) => Number.isInteger(tick.ingestSeq) && tick.ingestSeq > 0 ? tick.ingestSeq : 1))
    : 1;

  return {
    family: familyFor(input.role),
    status,
    exchangeTimestampMs,
    receivedAtMs,
    processedAtMs,
    ingestSeq,
    provenance: "KITE_WS",
    source: input.source?.trim() || "KITE_WS_CONSTITUENT_TICKS",
    payload: {
      parentSymbol: input.parentSymbol,
      role: input.role,
      expectedCount: expected.length,
      verifiedCount: verifiedRows.length,
      rows,
      readOnly: true,
      affectsVerdict: false,
      affectsExecution: false,
      affectsTelegram: false,
      grantsCandidateAuthority: false,
    },
    devilFlags: [...new Set(devilFlags)],
  };
}

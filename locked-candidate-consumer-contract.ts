import { createHash } from "node:crypto";

export type LockedCandidateSymbol = "NIFTY" | "SENSEX" | "BANKNIFTY";
export type LockedCandidateOptionSide = "CE" | "PE";
export type LockedCandidateBusinessRole = "OPTION_BUYER" | "OPTION_SELLER";
export type LockedCandidateMoneyness = "ATM" | "ITM1";
export type LockedCandidateMode = "SHADOW" | "LIVE";

export interface LockedCandidatePacketV1 {
  version: "LOCKED_CANDIDATE_PACKET_V1";
  decisionId: string;
  snapshotId: string;
  candidateKey: string;
  symbol: LockedCandidateSymbol;
  optionSide: LockedCandidateOptionSide;
  businessRole: LockedCandidateBusinessRole;
  expiry: string;
  strike: number;
  dte: number;
  moneyness: LockedCandidateMoneyness;
  instrumentToken: number;
  tradingSymbol: string;
  quantity: number;
  referencePremium: number;
  riskPolicyRef: string;
  selectorVersion: string;
  selectorReasons: readonly string[];
  freshnessTimestamp: string;
  lockedAtMs: number;
  mode: LockedCandidateMode;
  packetHash: string;
}

export type LockedCandidateProjection = Readonly<{
  decisionId: string;
  snapshotId: string;
  candidateKey: string;
  packetHash: string;
  symbol: LockedCandidateSymbol;
  optionSide: LockedCandidateOptionSide;
  businessRole: LockedCandidateBusinessRole;
  expiry: string;
  strike: number;
  dte: number;
  moneyness: LockedCandidateMoneyness;
  instrumentToken: number;
  tradingSymbol: string;
  quantity: number;
  referencePremium: number;
  riskPolicyRef: string;
  selectorVersion: string;
  selectorReasons: readonly string[];
  freshnessTimestamp: string;
  lockedAtMs: number;
  mode: LockedCandidateMode;
}>;

export interface LockedCandidateConsumerBundle {
  version: "LOCKED_CANDIDATE_CONSUMER_BUNDLE_V1";
  dashboard: LockedCandidateProjection;
  telegram: LockedCandidateProjection | null;
  kiteShadow: LockedCandidateProjection;
  journal: LockedCandidateProjection;
  telegramEligible: boolean;
  telegramReason: "OPTION_BUYER_LOCKED" | "SELLER_NOT_TRANSPORTABLE";
  createsOrders: false;
  liveExecutionEnabled: false;
}

function text(value: string, code: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(code);
  return normalized;
}

function positive(value: number, code: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new Error(code);
  return value;
}

function nonNegativeInteger(value: number, code: string): number {
  if (!Number.isInteger(value) || value < 0) throw new Error(code);
  return value;
}

function positiveInteger(value: number, code: string): number {
  if (!Number.isInteger(value) || value <= 0) throw new Error(code);
  return value;
}

function iso(value: string, code: string): string {
  const normalized = text(value, code);
  if (!Number.isFinite(Date.parse(normalized))) throw new Error(code);
  return new Date(normalized).toISOString();
}

function reasons(values: readonly string[]): readonly string[] {
  if (!Array.isArray(values)) throw new Error("SELECTOR_REASONS_REQUIRED");
  const normalized = values.map((value) => text(String(value), "SELECTOR_REASON_INVALID"));
  if (normalized.length === 0) throw new Error("SELECTOR_REASONS_REQUIRED");
  return Object.freeze([...normalized]);
}

function stablePayload(packet: Omit<LockedCandidatePacketV1, "packetHash">): string {
  return JSON.stringify({
    version: packet.version,
    decisionId: packet.decisionId,
    snapshotId: packet.snapshotId,
    candidateKey: packet.candidateKey,
    symbol: packet.symbol,
    optionSide: packet.optionSide,
    businessRole: packet.businessRole,
    expiry: packet.expiry,
    strike: packet.strike,
    dte: packet.dte,
    moneyness: packet.moneyness,
    instrumentToken: packet.instrumentToken,
    tradingSymbol: packet.tradingSymbol,
    quantity: packet.quantity,
    referencePremium: packet.referencePremium,
    riskPolicyRef: packet.riskPolicyRef,
    selectorVersion: packet.selectorVersion,
    selectorReasons: packet.selectorReasons,
    freshnessTimestamp: packet.freshnessTimestamp,
    lockedAtMs: packet.lockedAtMs,
    mode: packet.mode,
  });
}

export function computeLockedCandidatePacketHash(
  packet: Omit<LockedCandidatePacketV1, "packetHash">,
): string {
  return createHash("sha256").update(stablePayload(packet)).digest("hex");
}

export function lockCandidatePacket(
  input: Omit<LockedCandidatePacketV1, "version" | "packetHash">,
): LockedCandidatePacketV1 {
  if (input.symbol !== "NIFTY" && input.symbol !== "SENSEX" && input.symbol !== "BANKNIFTY") throw new Error("SYMBOL_INVALID");
  if (input.optionSide !== "CE" && input.optionSide !== "PE") throw new Error("OPTION_SIDE_INVALID");
  if (input.businessRole !== "OPTION_BUYER" && input.businessRole !== "OPTION_SELLER") throw new Error("BUSINESS_ROLE_INVALID");
  if (input.moneyness !== "ATM" && input.moneyness !== "ITM1") throw new Error("MONEYNESS_INVALID");
  if (input.mode !== "SHADOW" && input.mode !== "LIVE") throw new Error("MODE_INVALID");
  const withoutHash: Omit<LockedCandidatePacketV1, "packetHash"> = {
    version: "LOCKED_CANDIDATE_PACKET_V1",
    decisionId: text(input.decisionId, "DECISION_ID_REQUIRED"),
    snapshotId: text(input.snapshotId, "SNAPSHOT_ID_REQUIRED"),
    candidateKey: text(input.candidateKey, "CANDIDATE_KEY_REQUIRED"),
    symbol: input.symbol,
    optionSide: input.optionSide,
    businessRole: input.businessRole,
    expiry: text(input.expiry, "EXPIRY_REQUIRED"),
    strike: positive(input.strike, "STRIKE_INVALID"),
    dte: nonNegativeInteger(input.dte, "DTE_INVALID"),
    moneyness: input.moneyness,
    instrumentToken: positiveInteger(input.instrumentToken, "INSTRUMENT_TOKEN_INVALID"),
    tradingSymbol: text(input.tradingSymbol, "TRADING_SYMBOL_REQUIRED"),
    quantity: positive(input.quantity, "QUANTITY_INVALID"),
    referencePremium: positive(input.referencePremium, "REFERENCE_PREMIUM_INVALID"),
    riskPolicyRef: text(input.riskPolicyRef, "RISK_POLICY_REF_REQUIRED"),
    selectorVersion: text(input.selectorVersion, "SELECTOR_VERSION_REQUIRED"),
    selectorReasons: reasons(input.selectorReasons),
    freshnessTimestamp: iso(input.freshnessTimestamp, "FRESHNESS_TIMESTAMP_INVALID"),
    lockedAtMs: positive(input.lockedAtMs, "LOCKED_AT_INVALID"),
    mode: input.mode,
  };
  return Object.freeze({ ...withoutHash, packetHash: computeLockedCandidatePacketHash(withoutHash) });
}

export function assertLockedCandidatePacket(packet: LockedCandidatePacketV1): void {
  const { packetHash, ...withoutHash } = packet;
  if (!packetHash || packetHash !== computeLockedCandidatePacketHash(withoutHash)) {
    throw new Error("LOCKED_PACKET_HASH_MISMATCH");
  }
}

function projection(packet: LockedCandidatePacketV1): LockedCandidateProjection {
  return Object.freeze({
    decisionId: packet.decisionId,
    snapshotId: packet.snapshotId,
    candidateKey: packet.candidateKey,
    packetHash: packet.packetHash,
    symbol: packet.symbol,
    optionSide: packet.optionSide,
    businessRole: packet.businessRole,
    expiry: packet.expiry,
    strike: packet.strike,
    dte: packet.dte,
    moneyness: packet.moneyness,
    instrumentToken: packet.instrumentToken,
    tradingSymbol: packet.tradingSymbol,
    quantity: packet.quantity,
    referencePremium: packet.referencePremium,
    riskPolicyRef: packet.riskPolicyRef,
    selectorVersion: packet.selectorVersion,
    selectorReasons: packet.selectorReasons,
    freshnessTimestamp: packet.freshnessTimestamp,
    lockedAtMs: packet.lockedAtMs,
    mode: packet.mode,
  });
}

export function buildLockedCandidateConsumerBundle(
  packet: LockedCandidatePacketV1,
): LockedCandidateConsumerBundle {
  assertLockedCandidatePacket(packet);
  const shared = projection(packet);
  const telegramEligible = packet.businessRole === "OPTION_BUYER";
  return Object.freeze({
    version: "LOCKED_CANDIDATE_CONSUMER_BUNDLE_V1",
    dashboard: shared,
    telegram: telegramEligible ? shared : null,
    kiteShadow: shared,
    journal: shared,
    telegramEligible,
    telegramReason: telegramEligible ? "OPTION_BUYER_LOCKED" : "SELLER_NOT_TRANSPORTABLE",
    createsOrders: false,
    liveExecutionEnabled: false,
  });
}

export function sameLockedIdentity(
  a: LockedCandidateProjection,
  b: LockedCandidateProjection,
): boolean {
  return a.decisionId === b.decisionId
    && a.snapshotId === b.snapshotId
    && a.candidateKey === b.candidateKey
    && a.packetHash === b.packetHash;
}

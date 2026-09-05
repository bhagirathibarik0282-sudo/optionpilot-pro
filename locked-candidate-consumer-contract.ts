import { createHash } from "node:crypto";

export type LockedCandidateSymbol = "NIFTY" | "SENSEX" | "BANKNIFTY";
export type LockedCandidateOptionSide = "CE" | "PE";
export type LockedCandidateBusinessRole = "OPTION_BUYER" | "OPTION_SELLER";

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
  quantity: number;
  referencePremium: number;
  selectorVersion: string;
  lockedAtMs: number;
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
  quantity: number;
  referencePremium: number;
  selectorVersion: string;
  lockedAtMs: number;
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
    quantity: packet.quantity,
    referencePremium: packet.referencePremium,
    selectorVersion: packet.selectorVersion,
    lockedAtMs: packet.lockedAtMs,
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
    quantity: positive(input.quantity, "QUANTITY_INVALID"),
    referencePremium: positive(input.referencePremium, "REFERENCE_PREMIUM_INVALID"),
    selectorVersion: text(input.selectorVersion, "SELECTOR_VERSION_REQUIRED"),
    lockedAtMs: positive(input.lockedAtMs, "LOCKED_AT_INVALID"),
  };
  return { ...withoutHash, packetHash: computeLockedCandidatePacketHash(withoutHash) };
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
    quantity: packet.quantity,
    referencePremium: packet.referencePremium,
    selectorVersion: packet.selectorVersion,
    lockedAtMs: packet.lockedAtMs,
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

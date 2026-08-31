import { dbInsert, dbLoadRecent } from "./db.js";
import {
  validateShadowContractIdentity,
  type ShadowContractIdentity,
} from "./live-shadow-market-binding.js";

export const SHADOW_CONTRACT_IDENTITY_DB_KIND = "SHADOW_CONTRACT_IDENTITY_V1" as const;
export const SHADOW_CONTRACT_IDENTITY_HISTORY_SCAN_LIMIT = 1000 as const;

export interface ShadowContractIdentityPersistenceEnvelope {
  version: "SHADOW_CONTRACT_IDENTITY_PERSISTENCE_V1";
  persistedAt: string;
  tradeId: string;
  identity: ShadowContractIdentity;
  authorizesOrder: false;
  brokerOrderAllowed: false;
  placesOrder: false;
  shadowOnly: true;
  failClosed: true;
}

export interface ShadowContractIdentityPersistenceIo {
  insert(kind: string, payload: unknown): Promise<void>;
  loadRecent<T>(kind: string, limit: number): Promise<T[]>;
}

const defaultIo: ShadowContractIdentityPersistenceIo = {
  insert: dbInsert,
  loadRecent: dbLoadRecent,
};

function validTs(value: string): boolean {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function normalizeToken(value: ShadowContractIdentity["instrumentToken"]): string | null {
  return value === undefined || value === null ? null : String(value);
}

export function sameShadowContractIdentity(
  left: ShadowContractIdentity,
  right: ShadowContractIdentity,
): boolean {
  return !!left && !!right &&
    left.index === right.index &&
    left.optionType === right.optionType &&
    left.strike === right.strike &&
    left.expiry === right.expiry &&
    normalizeToken(left.instrumentToken) === normalizeToken(right.instrumentToken);
}

function validEnvelope(
  row: ShadowContractIdentityPersistenceEnvelope | null | undefined,
): row is ShadowContractIdentityPersistenceEnvelope {
  return !!row &&
    row.version === "SHADOW_CONTRACT_IDENTITY_PERSISTENCE_V1" &&
    validTs(row.persistedAt) &&
    typeof row.tradeId === "string" && row.tradeId.trim().length > 0 &&
    validateShadowContractIdentity(row.identity) &&
    row.authorizesOrder === false &&
    row.brokerOrderAllowed === false &&
    row.placesOrder === false &&
    row.shadowOnly === true &&
    row.failClosed === true;
}

function claimsTradeId(row: unknown, tradeId: string): boolean {
  if (!row || typeof row !== "object") return false;
  const candidate = row as { tradeId?: unknown };
  return typeof candidate.tradeId === "string" && candidate.tradeId.trim() === tradeId;
}

function hasTaintedClaim(rows: unknown[], tradeId: string): boolean {
  return rows.some((row) => claimsTradeId(row, tradeId) && !validEnvelope(row as ShadowContractIdentityPersistenceEnvelope));
}

function completeHistoryWindow(rows: unknown[]): boolean {
  return Array.isArray(rows) && rows.length < SHADOW_CONTRACT_IDENTITY_HISTORY_SCAN_LIMIT;
}

export function buildShadowContractIdentityPersistenceEnvelope(
  tradeId: string,
  identity: ShadowContractIdentity,
  persistedAt: string,
): ShadowContractIdentityPersistenceEnvelope | null {
  if (typeof tradeId !== "string" || !tradeId.trim() || !validTs(persistedAt)) return null;
  if (!validateShadowContractIdentity(identity)) return null;
  return {
    version: "SHADOW_CONTRACT_IDENTITY_PERSISTENCE_V1",
    persistedAt,
    tradeId: tradeId.trim(),
    identity: { ...identity },
    authorizesOrder: false,
    brokerOrderAllowed: false,
    placesOrder: false,
    shadowOnly: true,
    failClosed: true,
  };
}

export async function persistShadowContractIdentity(
  tradeId: string,
  identity: ShadowContractIdentity,
  persistedAt = new Date().toISOString(),
  io: ShadowContractIdentityPersistenceIo = defaultIo,
): Promise<boolean> {
  const envelope = buildShadowContractIdentityPersistenceEnvelope(tradeId, identity, persistedAt);
  if (!envelope || !io || typeof io.insert !== "function" || typeof io.loadRecent !== "function") return false;

  try {
    const before = await io.loadRecent<ShadowContractIdentityPersistenceEnvelope>(
      SHADOW_CONTRACT_IDENTITY_DB_KIND,
      SHADOW_CONTRACT_IDENTITY_HISTORY_SCAN_LIMIT,
    );
    if (!completeHistoryWindow(before)) return false;
    if (hasTaintedClaim(before, envelope.tradeId)) return false;
    const existing = before.filter((row) => validEnvelope(row) && row.tradeId === envelope.tradeId);
    if (existing.some((row) => !sameShadowContractIdentity(row.identity, envelope.identity))) return false;
    if (existing.some((row) => sameShadowContractIdentity(row.identity, envelope.identity))) return true;

    await io.insert(SHADOW_CONTRACT_IDENTITY_DB_KIND, envelope);

    const after = await io.loadRecent<ShadowContractIdentityPersistenceEnvelope>(
      SHADOW_CONTRACT_IDENTITY_DB_KIND,
      SHADOW_CONTRACT_IDENTITY_HISTORY_SCAN_LIMIT,
    );
    if (!completeHistoryWindow(after)) return false;
    if (hasTaintedClaim(after, envelope.tradeId)) return false;
    return after.some((row) =>
      validEnvelope(row) &&
      row.tradeId === envelope.tradeId &&
      row.persistedAt === envelope.persistedAt &&
      sameShadowContractIdentity(row.identity, envelope.identity)
    );
  } catch {
    return false;
  }
}

export async function loadShadowContractIdentity(
  tradeId: string,
  io: ShadowContractIdentityPersistenceIo = defaultIo,
): Promise<ShadowContractIdentity | null> {
  if (typeof tradeId !== "string" || !tradeId.trim()) return null;
  if (!io || typeof io.loadRecent !== "function") return null;

  try {
    const normalizedTradeId = tradeId.trim();
    const rows = await io.loadRecent<ShadowContractIdentityPersistenceEnvelope>(
      SHADOW_CONTRACT_IDENTITY_DB_KIND,
      SHADOW_CONTRACT_IDENTITY_HISTORY_SCAN_LIMIT,
    );
    if (!completeHistoryWindow(rows)) return null;
    if (hasTaintedClaim(rows, normalizedTradeId)) return null;
    const matches = rows.filter((row) => validEnvelope(row) && row.tradeId === normalizedTradeId);
    if (matches.length === 0) return null;

    const reference = matches[0].identity;
    if (matches.some((row) => !sameShadowContractIdentity(row.identity, reference))) return null;

    matches.sort((a, b) => Date.parse(b.persistedAt) - Date.parse(a.persistedAt));
    return { ...matches[0].identity };
  } catch {
    return null;
  }
}

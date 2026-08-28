import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { dbIsConfigured, dbQuerySafe } from "./db.js";

export const KITE_SESSION_AUTHORITY_VERSION = "PHASE61_KITE_SESSION_AUTHORITY_V1" as const;
export const KITE_SESSION_AUTHORITY_ID = "primary" as const;

type AuthorityCode =
  | "ACTIVE"
  | "RECONNECT_REQUIRED"
  | "NOT_CONFIGURED"
  | "STORAGE_UNAVAILABLE"
  | "DECRYPT_FAILED"
  | "USER_MISMATCH"
  | "INVALID_INPUT";

export interface KiteAuthoritySessionInput {
  accessToken: string;
  userId: string;
  email?: string | null;
  loginTime: number;
  expiresAt: number;
}

export interface KiteAuthorityResolvedSession {
  accessToken: string;
  userId: string;
  email: string | null;
  loginTime: number;
  expiresAt: number;
  source: "SHARED_DB_AUTHORITY";
}

export interface KiteAuthorityPublicStatus {
  version: typeof KITE_SESSION_AUTHORITY_VERSION;
  architectureRole: "CENTRAL_KITE_SESSION_AUTHORITY";
  code: AuthorityCode;
  active: boolean;
  reconnectRequired: boolean;
  userId: string | null;
  email: string | null;
  loginTime: string | null;
  expiresAt: string | null;
  tokenFingerprint: string | null;
  tokenExposed: false;
  autoLoginAttempted: false;
  productionDecisionImpact: "NONE";
}

type AuthorityDbRow = {
  access_token_ciphertext: string;
  user_id: string;
  email: string | null;
  login_time: string | Date;
  expires_at: string | Date;
  token_fingerprint: string | null;
};

function encryptionSecret(): string | null {
  const value = process.env.KITE_SESSION_ENCRYPTION_KEY?.trim() || "";
  return value.length >= 32 ? value : null;
}

function deriveKey(secret: string): Buffer {
  return createHash("sha256").update(secret, "utf8").digest();
}

export function encryptKiteAccessTokenForAuthority(plain: string, secret: string): string {
  if (!plain || !secret || secret.length < 32) throw new Error("KITE_SESSION_ENCRYPTION_KEY_INVALID");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(secret), iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

export function decryptKiteAccessTokenForAuthority(sealed: string, secret: string): string | null {
  try {
    if (!sealed || !secret || secret.length < 32) return null;
    const [ivHex, tagHex, dataHex] = sealed.split(":");
    if (!ivHex || !tagHex || !dataHex) return null;
    const decipher = createDecipheriv("aes-256-gcm", deriveKey(secret), Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    return Buffer.concat([decipher.update(Buffer.from(dataHex, "hex")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

export function kiteTokenFingerprint(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex").slice(0, 16);
}

function publicStatus(
  code: AuthorityCode,
  fields: Partial<Omit<KiteAuthorityPublicStatus, "version" | "architectureRole" | "code" | "active" | "reconnectRequired" | "tokenExposed" | "autoLoginAttempted" | "productionDecisionImpact">> = {},
): KiteAuthorityPublicStatus {
  return {
    version: KITE_SESSION_AUTHORITY_VERSION,
    architectureRole: "CENTRAL_KITE_SESSION_AUTHORITY",
    code,
    active: code === "ACTIVE",
    reconnectRequired: code === "RECONNECT_REQUIRED" || code === "DECRYPT_FAILED",
    userId: fields.userId ?? null,
    email: fields.email ?? null,
    loginTime: fields.loginTime ?? null,
    expiresAt: fields.expiresAt ?? null,
    tokenFingerprint: fields.tokenFingerprint ?? null,
    tokenExposed: false,
    autoLoginAttempted: false,
    productionDecisionImpact: "NONE",
  };
}

async function ensureAuthoritySchema(): Promise<boolean> {
  if (!dbIsConfigured()) return false;
  const result = await dbQuerySafe(`
    CREATE TABLE IF NOT EXISTS kite_session_authority (
      authority_id TEXT PRIMARY KEY,
      access_token_ciphertext TEXT NOT NULL,
      user_id TEXT NOT NULL,
      email TEXT,
      login_time TIMESTAMPTZ NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      token_fingerprint TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  return result !== null;
}

function validInput(input: KiteAuthoritySessionInput): boolean {
  return !!input.accessToken && !!input.userId && Number.isFinite(input.loginTime) && Number.isFinite(input.expiresAt) && input.expiresAt > input.loginTime;
}

export async function persistKiteAuthoritySession(
  input: KiteAuthoritySessionInput,
): Promise<{ ok: true; status: KiteAuthorityPublicStatus } | { ok: false; status: KiteAuthorityPublicStatus }> {
  if (!validInput(input)) return { ok: false, status: publicStatus("INVALID_INPUT") };
  const secret = encryptionSecret();
  if (!secret) return { ok: false, status: publicStatus("NOT_CONFIGURED") };
  if (!(await ensureAuthoritySchema())) return { ok: false, status: publicStatus("STORAGE_UNAVAILABLE") };

  const existing = await dbQuerySafe<{ user_id: string; expires_at: string | Date }>(
    `SELECT user_id, expires_at FROM kite_session_authority WHERE authority_id = $1`,
    [KITE_SESSION_AUTHORITY_ID],
  );
  if (existing === null) return { ok: false, status: publicStatus("STORAGE_UNAVAILABLE") };
  const row = existing.rows[0];
  if (row && new Date(row.expires_at).getTime() > Date.now() && row.user_id !== input.userId) {
    return { ok: false, status: publicStatus("USER_MISMATCH", { userId: row.user_id, expiresAt: new Date(row.expires_at).toISOString() }) };
  }

  const ciphertext = encryptKiteAccessTokenForAuthority(input.accessToken, secret);
  const fingerprint = kiteTokenFingerprint(input.accessToken);
  const write = await dbQuerySafe(
    `INSERT INTO kite_session_authority (
       authority_id, access_token_ciphertext, user_id, email, login_time, expires_at, token_fingerprint, updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,now())
     ON CONFLICT (authority_id) DO UPDATE SET
       access_token_ciphertext=EXCLUDED.access_token_ciphertext,
       user_id=EXCLUDED.user_id,
       email=EXCLUDED.email,
       login_time=EXCLUDED.login_time,
       expires_at=EXCLUDED.expires_at,
       token_fingerprint=EXCLUDED.token_fingerprint,
       updated_at=now()`,
    [KITE_SESSION_AUTHORITY_ID, ciphertext, input.userId, input.email ?? null, new Date(input.loginTime).toISOString(), new Date(input.expiresAt).toISOString(), fingerprint],
  );
  if (write === null) return { ok: false, status: publicStatus("STORAGE_UNAVAILABLE") };

  return {
    ok: true,
    status: publicStatus("ACTIVE", {
      userId: input.userId,
      email: input.email ?? null,
      loginTime: new Date(input.loginTime).toISOString(),
      expiresAt: new Date(input.expiresAt).toISOString(),
      tokenFingerprint: fingerprint,
    }),
  };
}

export async function resolveKiteAuthoritySession(now = Date.now()): Promise<{
  session: KiteAuthorityResolvedSession | null;
  status: KiteAuthorityPublicStatus;
}> {
  const secret = encryptionSecret();
  if (!secret) return { session: null, status: publicStatus("NOT_CONFIGURED") };
  if (!(await ensureAuthoritySchema())) return { session: null, status: publicStatus("STORAGE_UNAVAILABLE") };

  const read = await dbQuerySafe<AuthorityDbRow>(
    `SELECT access_token_ciphertext, user_id, email, login_time, expires_at, token_fingerprint
       FROM kite_session_authority WHERE authority_id = $1`,
    [KITE_SESSION_AUTHORITY_ID],
  );
  if (read === null) return { session: null, status: publicStatus("STORAGE_UNAVAILABLE") };
  const row = read.rows[0];
  if (!row) return { session: null, status: publicStatus("RECONNECT_REQUIRED") };

  const loginTime = new Date(row.login_time).getTime();
  const expiresAt = new Date(row.expires_at).getTime();
  const meta = {
    userId: row.user_id,
    email: row.email,
    loginTime: Number.isFinite(loginTime) ? new Date(loginTime).toISOString() : null,
    expiresAt: Number.isFinite(expiresAt) ? new Date(expiresAt).toISOString() : null,
    tokenFingerprint: row.token_fingerprint,
  };
  if (!Number.isFinite(expiresAt) || expiresAt <= now) {
    return { session: null, status: publicStatus("RECONNECT_REQUIRED", meta) };
  }

  const accessToken = decryptKiteAccessTokenForAuthority(row.access_token_ciphertext, secret);
  if (!accessToken) return { session: null, status: publicStatus("DECRYPT_FAILED", meta) };

  return {
    session: {
      accessToken,
      userId: row.user_id,
      email: row.email,
      loginTime,
      expiresAt,
      source: "SHARED_DB_AUTHORITY",
    },
    status: publicStatus("ACTIVE", meta),
  };
}

export async function getKiteAuthorityPublicStatus(): Promise<KiteAuthorityPublicStatus> {
  return (await resolveKiteAuthoritySession()).status;
}

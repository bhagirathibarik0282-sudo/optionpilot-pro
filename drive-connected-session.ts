import { createDecipheriv, createHash } from "node:crypto";
import { dbQuerySafe } from "./db.js";

export const DRIVE_CONNECTED_SESSION_KIND = "GOOGLE_DRIVE_CONNECTED_SESSION_V1";
type Query = typeof dbQuerySafe;
type SealedSession = { version: string; refreshTokenEncrypted: string; clientFingerprint: string; connectedAt: string };

export function decodeConnectedDriveSession(payload: SealedSession, clientId: string, clientSecret: string): string {
  if (payload.version !== DRIVE_CONNECTED_SESSION_KIND || !clientId || !clientSecret || payload.clientFingerprint !== createHash("sha256").update(clientId).digest("hex")) throw new Error("DRIVE_CONNECTED_SESSION_CLIENT_MISMATCH");
  try {
    const [iv, tag, ciphertext, extra] = payload.refreshTokenEncrypted.split(":");
    if (extra || !/^[a-f0-9]{24}$/i.test(iv) || !/^[a-f0-9]{32}$/i.test(tag) || !/^(?:[a-f0-9]{2})+$/i.test(ciphertext)) throw new Error();
    const decipher = createDecipheriv("aes-256-gcm", createHash("sha256").update(clientSecret).digest(), Buffer.from(iv, "hex"));
    decipher.setAuthTag(Buffer.from(tag, "hex"));
    const token = Buffer.concat([decipher.update(Buffer.from(ciphertext, "hex")), decipher.final()]).toString("utf8");
    if (!token) throw new Error();
    return token;
  } catch { throw new Error("DRIVE_CONNECTED_SESSION_DECRYPT_FAILED"); }
}

export async function persistConnectedDriveSession(refreshTokenEncrypted: string | null, connectedAt: string | null, query: Query = dbQuerySafe): Promise<boolean> {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim(), clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  if (!refreshTokenEncrypted || !connectedAt || !Number.isFinite(Date.parse(connectedAt)) || !clientId || !clientSecret) return false;
  const payload: SealedSession = { version: DRIVE_CONNECTED_SESSION_KIND, refreshTokenEncrypted, connectedAt, clientFingerprint: createHash("sha256").update(clientId).digest("hex") };
  // Validate integrity before persisting; neither access nor plain refresh tokens are saved.
  decodeConnectedDriveSession(payload, clientId, clientSecret);
  const result = await query("INSERT INTO app_state_log(kind,payload) SELECT $1,$2::jsonb WHERE NOT EXISTS (SELECT 1 FROM app_state_log WHERE kind=$1 AND payload=$2::jsonb) RETURNING id", [DRIVE_CONNECTED_SESSION_KIND, JSON.stringify(payload)]);
  if (!result) return false;
  const readback = await query<{ payload: SealedSession }>("SELECT payload FROM app_state_log WHERE kind=$1 AND payload=$2::jsonb LIMIT 1", [DRIVE_CONNECTED_SESSION_KIND, JSON.stringify(payload)]);
  return Boolean(readback?.rows.length);
}

export async function loadConnectedDriveRefreshToken(clientId: string, clientSecret: string, query: Query = dbQuerySafe): Promise<string | null> {
  if (!process.env.DATABASE_URL?.trim()) return null;
  const result = await query<{ payload: SealedSession }>("SELECT payload FROM app_state_log WHERE kind=$1 ORDER BY payload->>'connectedAt' DESC, id DESC LIMIT 1", [DRIVE_CONNECTED_SESSION_KIND]);
  if (!result) throw new Error("DRIVE_CONNECTED_SESSION_STORAGE_UNAVAILABLE");
  if (!result.rows.length) return null; // backwards-compatible env auth only before first shared session
  return decodeConnectedDriveSession(result.rows[0].payload, clientId, clientSecret);
}

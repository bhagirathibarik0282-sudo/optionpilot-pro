import { createHash, createSign } from "node:crypto";

export interface DriveUploadResult {
  fileId: string;
  name: string;
  size: number | null;
  checksumSha256: string;
}

function b64url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_NOT_SET`);
  return value;
}

async function getServiceAccountAccessToken(): Promise<string> {
  const clientEmail = requiredEnv("GOOGLE_DRIVE_SERVICE_ACCOUNT_EMAIL");
  const privateKey = requiredEnv("GOOGLE_DRIVE_SERVICE_ACCOUNT_PRIVATE_KEY").replace(/\\n/g, "\n");
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(JSON.stringify({
    iss: clientEmail,
    scope: "https://www.googleapis.com/auth/drive.file",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));
  const unsigned = `${header}.${claim}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const assertion = `${unsigned}.${b64url(signer.sign(privateKey))}`;

  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion,
  });
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = await response.json() as { access_token?: string; error?: string; error_description?: string };
  if (!response.ok || !json.access_token) {
    throw new Error(`GOOGLE_TOKEN_FAILED:${json.error || response.status}:${json.error_description || "unknown"}`);
  }
  return json.access_token;
}

export function eodArchiveChecksum(payloadJson: string): string {
  return createHash("sha256").update(payloadJson, "utf8").digest("hex");
}

export async function uploadEodArchiveToDrive(tradingDate: string, payloadJson: string): Promise<DriveUploadResult> {
  const folderId = requiredEnv("GOOGLE_DRIVE_EOD_FOLDER_ID");
  const token = await getServiceAccountAccessToken();
  const fileName = `optionpilot-eod-${tradingDate}.json`;
  const checksumSha256 = eodArchiveChecksum(payloadJson);
  const boundary = `optionpilot_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const metadata = JSON.stringify({
    name: fileName,
    parents: [folderId],
    appProperties: { tradingDate, checksumSha256, schemaVersion: "EOD_ARCHIVE_V1" },
  });
  const multipart = [
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`,
    `--${boundary}\r\nContent-Type: application/json\r\n\r\n${payloadJson}\r\n`,
    `--${boundary}--`,
  ].join("");

  const upload = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,size,trashed,appProperties", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": `multipart/related; boundary=${boundary}`,
    },
    body: multipart,
  });
  const created = await upload.json() as { id?: string; name?: string; size?: string; trashed?: boolean; appProperties?: Record<string, string>; error?: { message?: string } };
  if (!upload.ok || !created.id) throw new Error(`DRIVE_UPLOAD_FAILED:${created.error?.message || upload.status}`);

  const verify = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(created.id)}?fields=id,name,size,trashed,parents,appProperties`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const checked = await verify.json() as { id?: string; name?: string; size?: string; trashed?: boolean; parents?: string[]; appProperties?: Record<string, string>; error?: { message?: string } };
  if (!verify.ok) throw new Error(`DRIVE_VERIFY_FAILED:${checked.error?.message || verify.status}`);
  if (checked.id !== created.id || checked.name !== fileName || checked.trashed === true) throw new Error("DRIVE_VERIFY_METADATA_MISMATCH");
  if (!checked.parents?.includes(folderId)) throw new Error("DRIVE_VERIFY_WRONG_FOLDER");
  if (checked.appProperties?.checksumSha256 !== checksumSha256) throw new Error("DRIVE_VERIFY_CHECKSUM_TAG_MISMATCH");

  return {
    fileId: created.id,
    name: checked.name || fileName,
    size: checked.size ? Number(checked.size) : null,
    checksumSha256,
  };
}

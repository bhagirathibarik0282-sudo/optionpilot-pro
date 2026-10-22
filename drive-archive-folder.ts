// Archive-only folder resolver. Never copy Google's raw message/body into
// public diagnostics: they may contain account identifiers or credentials.
const SAFE_REASONS = new Set([
  'authError', 'invalidCredentials', 'insufficientPermissions', 'forbidden',
  'accessNotConfigured', 'serviceDisabled', 'storageQuotaExceeded',
  'rateLimitExceeded', 'userRateLimitExceeded', 'dailyLimitExceeded',
  'backendError', 'notFound', 'invalid', 'ACCESS_TOKEN_SCOPE_INSUFFICIENT',
  'SERVICE_DISABLED', 'UNAUTHENTICATED', 'PERMISSION_DENIED', 'RESOURCE_EXHAUSTED',
]);

async function folderRequest(stage: 'LOOKUP' | 'CREATE', url: string, init: RequestInit, fetcher: typeof fetch) {
  const prefix = `GOOGLE_DRIVE_FOLDER_${stage}_FAILED`;
  let response: Response;
  try { response = await fetcher(url, init); }
  catch { throw new Error(`${prefix}:NETWORK_ERROR`); }
  let body: any;
  try { body = await response.json(); }
  catch { throw new Error(`${prefix}:HTTP_${response.status}:INVALID_RESPONSE`); }
  if (!response.ok) {
    const reasons = [body?.error?.errors?.[0]?.reason,
      ...(Array.isArray(body?.error?.details) ? body.error.details.map((x: any) => x?.reason) : []),
      body?.error?.status];
    const reason = reasons.find(x => typeof x === 'string' && SAFE_REASONS.has(x)) || 'UNKNOWN';
    throw new Error(`${prefix}:HTTP_${response.status}:${reason}`);
  }
  return body;
}

export async function findOrCreateArchiveDriveFolder(name: string, parentId: string | null, token: string, fetcher: typeof fetch = fetch): Promise<string> {
  const escape = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const parent = parentId ? escape(parentId) : 'root';
  const q = `name='${escape(name)}' and mimeType='application/vnd.google-apps.folder' and trashed=false and '${parent}' in parents`;
  const body = await folderRequest('LOOKUP', `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)`, {
    headers: { Authorization: `Bearer ${token}` },
  }, fetcher);
  if (!Array.isArray(body?.files)) throw new Error('GOOGLE_DRIVE_FOLDER_LOOKUP_FAILED:INVALID_RESPONSE');
  if (body.files.length) {
    if (typeof body.files[0]?.id !== 'string' || !body.files[0].id.trim()) throw new Error('GOOGLE_DRIVE_FOLDER_LOOKUP_FAILED:INVALID_RESPONSE');
    return body.files[0].id;
  }
  // Only a successful, empty lookup permits creation. Failed lookups must
  // not create duplicate folders or hide the actual permission/API error.
  const created = await folderRequest('CREATE', 'https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', ...(parentId ? { parents: [parentId] } : {}) }),
  }, fetcher);
  if (typeof created?.id !== 'string' || !created.id.trim()) throw new Error('GOOGLE_DRIVE_FOLDER_CREATE_FAILED:INVALID_RESPONSE');
  return created.id;
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { findOrCreateArchiveDriveFolder } from '../drive-archive-folder.js';

const token = 'fixture-secret-never-echo';
const resolve = (fetcher: typeof fetch) => findOrCreateArchiveDriveFolder('Journal', null, token, fetcher);

test('existing folder is reused without a create request', async () => {
  let calls = 0;
  assert.equal(await resolve(async (_url, init) => {
    calls++; assert.equal(init?.method, undefined);
    return Response.json({ files: [{ id: 'existing' }] });
  }), 'existing');
  assert.equal(calls, 1);
});

test('empty successful lookup creates in the exact requested parent', async () => {
  const calls: any[] = [];
  const id = await findOrCreateArchiveDriveFolder("Jo'urnal", 'parent-id', token, async (url, init) => {
    calls.push({ url: String(url), init });
    return Response.json(calls.length === 1 ? { files: [] } : { id: 'new-folder' });
  });
  assert.equal(id, 'new-folder');
  assert.equal(calls.length, 2);
  assert(new URL(calls[0].url).searchParams.get('q')?.includes("name='Jo\\'urnal'"));
  assert.deepEqual(JSON.parse(calls[1].init.body).parents, ['parent-id']);
});

for (const [status, reason] of [[401, 'authError'], [403, 'insufficientPermissions'], [403, 'accessNotConfigured'], [429, 'rateLimitExceeded'], [503, 'backendError']] as const) {
  test(`lookup ${status}/${reason} stops before create and returns safe reason`, async () => {
    let calls = 0;
    await assert.rejects(resolve(async () => {
      calls++;
      return Response.json({ error: { message: token, errors: [{ reason }] } }, { status });
    }), { message: `GOOGLE_DRIVE_FOLDER_LOOKUP_FAILED:HTTP_${status}:${reason}` });
    assert.equal(calls, 1);
  });
}

test('create quota error preserves stage/status/reason without exposing raw data', async () => {
  let calls = 0;
  await assert.rejects(resolve(async () => ++calls === 1 ? Response.json({ files: [] }) :
    Response.json({ error: { message: token, errors: [{ reason: 'storageQuotaExceeded' }] } }, { status: 403 })),
    { message: 'GOOGLE_DRIVE_FOLDER_CREATE_FAILED:HTTP_403:storageQuotaExceeded' });
  assert.equal(calls, 2);
});

test('untrusted error reason is replaced, detailed Google scope reason is allowed', async () => {
  await assert.rejects(resolve(async () => Response.json({ error: { message: token, errors: [{ reason: token }] } }, { status: 403 })),
    { message: 'GOOGLE_DRIVE_FOLDER_LOOKUP_FAILED:HTTP_403:UNKNOWN' });
  await assert.rejects(resolve(async () => Response.json({ error: { details: [{ reason: 'ACCESS_TOKEN_SCOPE_INSUFFICIENT' }] } }, { status: 403 })),
    { message: 'GOOGLE_DRIVE_FOLDER_LOOKUP_FAILED:HTTP_403:ACCESS_TOKEN_SCOPE_INSUFFICIENT' });
});

test('network, non-JSON and malformed successful lookups fail closed without create', async () => {
  for (const mode of ['network', 'html', 'shape', 'missing-id']) {
    let calls = 0;
    await assert.rejects(resolve(async () => {
      calls++;
      if (mode === 'network') throw new Error(token);
      if (mode === 'html') return new Response(token, { status: 502 });
      return Response.json(mode === 'shape' ? {} : { files: [{}] });
    }), error => error instanceof Error && error.message.startsWith('GOOGLE_DRIVE_FOLDER_LOOKUP_FAILED:') && !error.message.includes(token));
    assert.equal(calls, 1);
  }
});

test('successful create must return a nonempty folder ID', async () => {
  let calls = 0;
  await assert.rejects(resolve(async () => Response.json(++calls === 1 ? { files: [] } : {})),
    { message: 'GOOGLE_DRIVE_FOLDER_CREATE_FAILED:INVALID_RESPONSE' });
});

const source = readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
function runtime() {
  const context: any = { Error, driveSession: { lastError: null }, driveArchives: [],
    recorderSession: { tradingDate: '2026-10-21' }, indiaTradingDate: () => '2026-10-21', computeArchiveSearchTags: () => [],
    getValidDriveAccessToken: async () => token,
    findOrCreateArchiveDriveFolder: (name: string, parent: string | null, access: string) => findOrCreateArchiveDriveFolder(name, parent, access,
      async () => Response.json({ error: { errors: [{ reason: 'accessNotConfigured' }], message: token } }, { status: 403 })),
    uploadFileToDrive: async () => { throw new Error('UPLOAD_MUST_NOT_RUN'); },
    app: { post: (_path: string, handler: any) => { context.handler = handler; } } };
  vm.createContext(context);
  return context;
}

test('actual test-upload handler returns the diagnostic and updates status without upload', async () => {
  const context = runtime();
  const start = source.indexOf('app.post("/api/drive/test-upload"');
  vm.runInContext(stripTypeScriptTypes(source.slice(start, source.indexOf('\nasync function performDriveArchive()', start))), context);
  const result = await context.handler({ json: (body: any, status: number) => ({ body, status }) });
  assert.equal(result.status, 500);
  assert.equal(result.body.error, 'GOOGLE_DRIVE_FOLDER_LOOKUP_FAILED:HTTP_403:accessNotConfigured');
  assert.equal(context.driveSession.lastError, result.body.error);
});

test('actual archive runtime records failure and creates no success receipt on folder error', async () => {
  const context = runtime();
  const start = source.indexOf('async function performDriveArchive()');
  vm.runInContext(stripTypeScriptTypes(source.slice(start, source.indexOf('\napp.post("/api/drive/archive"', start))), context);
  const result = await context.performDriveArchive();
  assert.equal(result.success, false);
  assert.equal(result.record.status, 'ARCHIVE_FAILED');
  assert.equal(result.record.verifiedAt, null);
  assert.equal(Object.keys(result.record.fileIds).length, 0);
  assert.equal(context.driveArchives.length, 1);
  assert.equal(context.driveSession.lastError, 'GOOGLE_DRIVE_FOLDER_LOOKUP_FAILED:HTTP_403:accessNotConfigured');
});

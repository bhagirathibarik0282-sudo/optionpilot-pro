import http from 'node:http';
import { spawn } from 'node:child_process';
import { timingSafeEqual } from 'node:crypto';
import { createRuntimeControlPanel } from './runtime-control-panel.mjs';
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { operatingStatus, maintenanceExpiry } from '../runtime-operating-window.ts';

export function createSupervisor({
  now = () => new Date(),
  env = process.env,
  port = Number(env.PORT || 8080),
  childPort = Number(env.OPTIONPILOT_CHILD_PORT || (port === 8081 ? 8082 : 8081)),
  stateDir = env.RAILWAY_VOLUME_MOUNT_PATH || '/app/data',
  runtimeEntry = 'scripts/optionpilot-runtime-child.mjs',
  cadenceMs = 5_000,
  probeMs = 2_000,
  recordedHandler,
} = {}) {
if (port === childPort) throw new Error('SUPERVISOR_PORT_COLLISION');
const statePath = join(stateDir, 'runtime-maintenance-window.json');
let overrideUntil = 0;
try { overrideUntil = maintenanceExpiry(JSON.parse(readFileSync(statePath, 'utf8')).until, now()); } catch {}
let child = null, draining = false, ready = false, retryAt = 0, stopping = false, requests = 0;
const peers = new Set();
const streams = new Set();
// Import the SELECT-only archive viewer on demand. The market runtime remains stopped.
let archiveHandler = recordedHandler;
async function recorded(request, response) {
  const path = new URL(request.url || '/', 'http://localhost').pathname;
  if (!(path === '/recorded-dashboard' || path.startsWith('/api/research/recorded-dashboard/') ||
      (!status().shouldRun && (path === '/' || path === '/api/research/business-dashboard/view')))) return false;
  archiveHandler ||= import('../recorded-dashboard-http.ts').then(module => module.createRecordedDashboardHandler());
  try { return await (await archiveHandler)(request, response, status()); }
  catch { reply(response, 503, { error: 'RECORDED_VIEW_UNAVAILABLE' }); return true; }
}
function status() {
  return { ...operatingStatus(now(), overrideUntil), running: Boolean(child), ready, draining,
    hoursIST: '08:45–16:15', timezone: 'Asia/Kolkata', supervisor: true,
    maintenanceUntil: overrideUntil > now().getTime() ? new Date(overrideUntil).toISOString() : null };
}
function reply(response, code, body) {
  response.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}
function authorized(request) {
  const secret = env.RESEARCH_ADMIN_TOKEN;
  const input = request.headers.authorization || '';
  if (!secret) return false;
  const expected = Buffer.from(`Bearer ${secret}`), actual = Buffer.from(input);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
async function reconcile() {
  if (stopping) return;
  const wanted = status().shouldRun;
  if (!wanted) {
    for (const response of streams) response.end();
    for (const socket of peers) socket.destroy();
  }
  if (wanted && !child && now().getTime() >= retryAt) {
    ready = false; draining = false;
    child = spawn(process.execPath, ['--import', 'tsx', runtimeEntry], {
      env: { ...env, PORT: String(childPort) }, stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    });
    const started = child;
    child.on('error', error => console.error('[RUNTIME_SPAWN]', error.message));
    child.on('exit', code => {
      if (child !== started) return;
      child = null; ready = false; draining = false; retryAt = now().getTime() + 15_000;
      console.log(`[RUNTIME_EXIT] code=${code}`);
    });
    console.log('[RUNTIME_START] scheduled or authorized maintenance window');
  }
  if (!wanted && child && !draining && requests === 0) {
    draining = true; ready = false;
    for (const socket of peers) socket.destroy();
    child.send({ type: 'DRAIN' });
    console.log('[RUNTIME_STOP] graceful drain requested');
  }
}
async function setManualWindow(minutes) {
  const until = minutes ? new Date(now().getTime() + minutes * 60_000).toISOString() : null;
  try {
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(`${statePath}.tmp`, JSON.stringify({ until }), { mode: 0o600 });
    renameSync(`${statePath}.tmp`, statePath);
  } catch {
    return { ok: false, error: 'RUNTIME_WINDOW_SAVE_FAILED', ...status() };
  }
  overrideUntil = until ? Date.parse(until) : 0;
  await reconcile();
  return { ok: true, until, ...status() };
}
const controlPanel = createRuntimeControlPanel({
  env, now, status, start: minutes => setManualWindow(minutes), stop: () => setManualWindow(0),
});
const server = http.createServer(async (request, response) => {
  if (await controlPanel(request, response)) return;
  const path = new URL(request.url || '/', 'http://localhost').pathname;
  if (path === '/ops/runtime-status') return reply(response, 200, status());
  if (path === '/ops/runtime-window') {
    if (request.method !== 'POST') return reply(response, 405, { error: 'POST_REQUIRED' });
    if (!authorized(request)) return reply(response, 401, { error: 'UNAUTHORIZED' });
    try {
      let raw = '';
      for await (const chunk of request) { raw += chunk; if (raw.length > 1024) throw new Error('BODY_TOO_LARGE'); }
      const { minutes } = JSON.parse(raw);
      if (!Number.isInteger(minutes) || minutes < 1 || minutes > 60) return reply(response, 400, { error: 'MINUTES_MUST_BE_1_TO_60' });
      const result = await setManualWindow(minutes);
      return reply(response, result.ok ? 200 : 503, result);
    } catch { return reply(response, 400, { error: 'INVALID_REQUEST_OR_STATE_WRITE_FAILED' }); }
  }
  if (path === '/health' && (!status().shouldRun || !ready)) {
    return reply(response, status().shouldRun ? 503 : 200, { ok: !status().shouldRun, mode: 'SUPERVISOR', ...status() });
  }
  if (await recorded(request, response)) return;
  if (!status().shouldRun || !child || !ready || draining) {
    response.setHeader('Retry-After', '15');
    return reply(response, 503, { error: status().shouldRun ? 'RUNTIME_STARTING' : 'OUTSIDE_OPERATING_HOURS', ...status() });
  }
  requests++;
  let finished = false;
  const finish = () => { if (!finished) { finished = true; requests--; } };
  response.once('close', finish);
  response.once('finish', finish);
  const upstream = http.request({ hostname: '127.0.0.1', port: childPort, path: request.url,
    method: request.method, headers: request.headers }, result => {
    if (String(result.headers['content-type']).startsWith('text/event-stream')) {
      streams.add(response); response.once('close', () => streams.delete(response));
    }
    response.writeHead(result.statusCode || 502, result.headers);
    result.pipe(response);
  });
  upstream.on('error', () => { if (!response.headersSent) reply(response, 502, { error: 'RUNTIME_UNAVAILABLE' }); else response.destroy(); });
  request.once('aborted', () => upstream.destroy());
  response.once('close', () => upstream.destroy());
  request.pipe(upstream);
});
server.on('upgrade', (request, socket, head) => {
  if (!ready || draining || !status().shouldRun) { socket.end('HTTP/1.1 503 Service Unavailable\r\n\r\n'); return; }
  const upstream = http.request({ hostname: '127.0.0.1', port: childPort, path: request.url, headers: request.headers });
  upstream.on('upgrade', (response, target, data) => {
    peers.add(socket); socket.once('close', () => { peers.delete(socket); target.destroy(); });
    target.once('close', () => socket.destroy());
    socket.write(`HTTP/1.1 101 Switching Protocols\r\n${Object.entries(response.headers).map(([key, value]) => `${key}: ${value}`).join('\r\n')}\r\n\r\n`);
    if (head.length) target.write(head); if (data.length) socket.write(data);
    socket.pipe(target).pipe(socket); target.on('error', () => socket.destroy());
  });
  upstream.on('response', response => { response.resume(); socket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n'); });
  upstream.on('error', () => socket.destroy()); upstream.end();
});
server.listen(port, () => { console.log(`[SUPERVISOR] listening port=${port}`); void reconcile(); });
const clockTimer = setInterval(() => { void reconcile(); }, cadenceMs);
const probeTimer = setInterval(() => {
  if (!child || draining) return;
  const request = http.get({ hostname: '127.0.0.1', port: childPort, path: '/health', timeout: 2_000 }, response => {
    ready = response.statusCode === 200; response.resume();
  });
  request.on('timeout', () => request.destroy()); request.on('error', () => { ready = false; });
}, probeMs);
async function close() {
  stopping = true; ready = false;
  clearInterval(clockTimer); clearInterval(probeTimer);
  for (const response of streams) response.end();
  for (const socket of peers) socket.destroy();
  const closed = new Promise(resolve => server.close(resolve));
  if (child) {
    const ended = new Promise(resolve => child.once('exit', resolve));
    if (child.connected) child.send({ type: 'DRAIN' });
    await ended;
  }
  await closed;
}
return { server, status, reconcile, close };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const supervisor = createSupervisor();
  process.on('SIGTERM', () => { void supervisor.close().then(() => process.exit(0)); });
}

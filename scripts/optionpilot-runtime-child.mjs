// Only the main app uses this entrypoint. Independent FII/DII/EOD cron jobs
// never import it. Stop new interval work and drain active I/O before exiting.
import { startTelegramSettings } from '../telegram-ladder-settings.ts';
startTelegramSettings();
import pg from 'pg';
import { spawn } from 'node:child_process';

import { installRuntimeIoTracker } from './runtime-io-tracker.mjs';
const tracker = installRuntimeIoTracker(globalThis, pg.Client);
let draining = false, quietSince = 0;

const ready = (async () => {
  await new Promise((resolve, reject) => {
    const child = spawn('npm', ['run', 'start:prepare'], { stdio: 'inherit', env: process.env });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`PREPARE_EXIT_${code}`)));
  });
  // Match the original startup audit and optional shadow service.
  await import('../h1-live-contract-discovery-startup-audit.ts');
  const { startKiteShadowService } = await import('../kite-shadow-runtime-service.ts');
  void startKiteShadowService().catch(error => console.error('[SHADOW_STARTUP]', error.message));
  await import('../h1-same-process-server-entry.ts');
  return import('../server.ts');
})();
ready.catch(error => { console.error('[RUNTIME_START_FAILED]', error.message); process.exit(1); });

async function drain() {
  if (draining) return;
  draining = true;
  tracker.stopIntervals();
  const server = await ready;
  console.log('[RUNTIME_DRAIN] new interval work stopped; waiting for recording and I/O');
  const timer = tracker.nativeInterval(() => {
    if (tracker.pending() || !server.runtimeDrainReady()) { quietSince = 0; return; }
    quietSince ||= Date.now();
    if (Date.now() - quietSince < 3_000) return;
    clearInterval(timer);
    process.send?.({ type: 'DRAINED' });
    process.exit(0);
  }, 250);
}
process.on('message', message => { if (message?.type === 'DRAIN') void drain().catch(error => console.error('[RUNTIME_DRAIN_FAILED]', error.message)); });
process.on('SIGTERM', () => { void drain().catch(error => console.error('[RUNTIME_DRAIN_FAILED]', error.message)); });

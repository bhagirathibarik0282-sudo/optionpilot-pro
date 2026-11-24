import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

test('window summary survives Z-WATCH insertion and repeated process startups', () => {
  const root = mkdtempSync(join(tmpdir(), 'telegram-startup-'));
  try {
    mkdirSync(join(root, 'scripts'));
    for (const name of ['server.ts', 'meaningful-live-telegram.ts']) {
      copyFileSync(resolve(name), join(root, name));
    }
    for (const name of ['wire-telegram-3m-fused-runtime.mjs', 'wire-telegram-window-summary-runtime.mjs', 'wire-telegram-z-watch-exact-runtime-v1.mjs']) {
      copyFileSync(resolve('scripts', name), join(root, 'scripts', name));
    }
    const run = name => execFileSync(process.execPath, [join(root, 'scripts', name)], { cwd: root });
    run('wire-telegram-3m-fused-runtime.mjs');
    run('wire-telegram-window-summary-runtime.mjs');
    run('wire-telegram-z-watch-exact-runtime-v1.mjs');
    const prepared = readFileSync(join(root, 'server.ts'), 'utf8');
    for (let restart = 0; restart < 3; restart++) {
      run('wire-telegram-window-summary-runtime.mjs');
      run('wire-telegram-z-watch-exact-runtime-v1.mjs');
      assert.equal(readFileSync(join(root, 'server.ts'), 'utf8'), prepared);
    }
    assert.equal(prepared.split('const pulseDue =').length - 1, 1);
    assert.equal(prepared.split('OPTIONPILOT_TELEGRAM_BUSINESS_WATCH_EXACT_Z_V1').length - 1, 1);
    assert.ok(prepared.includes('if (pulseDue && TELEGRAM_3M_FUSED_DEDUP.shouldEmit(view))'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

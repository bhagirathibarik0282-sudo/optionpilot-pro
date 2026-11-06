import test from 'node:test';
import assert from 'node:assert/strict';
import { windowSummaryCadenceAlreadyWired } from '../scripts/telegram-window-wirer-guard.mjs';

const wired = [
  'const summaryWindows = ([3, 6, 15, 30, 60] as const).map(() => null);',
  'view.text += `\\n\\n🧠 WINDOW SUMMARIES\\n${summaryWindows.map((x) => x.text).join("\\n")}`;',
  'console.log(`[TELEGRAM_WINDOW_SUMMARY] ok`);',
  'const pulseDue = Number.isFinite(pulseMinute) && pulseMinute % 15 === 0;',
  'if (pulseDue && TELEGRAM_3M_FUSED_DEDUP.shouldEmit(view)) {',
].join('\n');

test('recognizes a completed 15m Telegram window summary gate', () => {
  assert.equal(windowSummaryCadenceAlreadyWired(wired), true);
});

test('remains idempotent after Z-WATCH inserts code ahead of the cadence gate', () => {
  const withWatch = wired.replace(
    'if (pulseDue && TELEGRAM_3M_FUSED_DEDUP.shouldEmit(view)) {',
    'view.text += "EXACT Z-WATCH";\nif (pulseDue && TELEGRAM_3M_FUSED_DEDUP.shouldEmit(view)) {',
  );
  assert.equal(windowSummaryCadenceAlreadyWired(withWatch), true);
});

test('does not treat missing or incorrect cadence as already wired', () => {
  assert.equal(windowSummaryCadenceAlreadyWired(wired.replace('🧠 WINDOW SUMMARIES', 'NO SUMMARY')), false);
  assert.equal(windowSummaryCadenceAlreadyWired(wired.replace('pulseMinute % 15', 'pulseMinute % 3')), false);
  assert.equal(windowSummaryCadenceAlreadyWired(wired.replace('if (pulseDue && ', 'if (')), false);
  assert.equal(windowSummaryCadenceAlreadyWired(wired.replace('[TELEGRAM_WINDOW_SUMMARY]', '[OTHER_SUMMARY]')), false);
});

test('rejects markers that appear in the wrong order', () => {
  const wrongOrder = wired.replace(
    'const pulseDue = Number.isFinite(pulseMinute) && pulseMinute % 15 === 0;\n',
    '',
  ).replace('const summaryWindows =', 'const pulseDue = Number.isFinite(pulseMinute) && pulseMinute % 15 === 0;\nconst summaryWindows =');
  assert.equal(windowSummaryCadenceAlreadyWired(wrongOrder), false);
});

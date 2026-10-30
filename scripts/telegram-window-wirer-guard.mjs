// Runtime wirers are applied to the same server.ts in sequence. A later Z-WATCH
// insertion can separate the window-summary text from the 15m send gate, so a
// whole multi-line replacement string is not a stable idempotence marker.
export function windowSummaryCadenceAlreadyWired(src) {
  const summaryText = 'view.text += `\\n\\n🧠 WINDOW SUMMARIES';
  const summaryDefinition = 'const summaryWindows =';
  const markersAfterText = [
    '[TELEGRAM_WINDOW_SUMMARY]',
    'const pulseDue = Number.isFinite(pulseMinute) && pulseMinute % 15 === 0;',
    'if (pulseDue && TELEGRAM_3M_FUSED_DEDUP.shouldEmit(view)) {',
  ];
  let cursor = src.indexOf(summaryText);
  if (cursor < 0 || src.lastIndexOf(summaryDefinition, cursor) < 0) return false;
  cursor += summaryText.length;
  for (const marker of markersAfterText) {
    const index = src.indexOf(marker, cursor);
    if (index < 0) return false;
    cursor = index + marker.length;
  }
  return true;
}

import type { CanonicalConstituentTick } from "./canonical-constituent-live-component.js";
import type { KiteConstituentMinuteRecord } from "./kite-constituent-runtime-bridge-v1.js";

/** Bounded observation consumer of already-validated ticks; no timer or socket. */
export class HawkEyeClosedMinuteBufferV1 {
  private openMinute: number | null = null;
  private ticks = new Map<number, CanonicalConstituentTick>();
  private closed: KiteConstituentMinuteRecord[] = [];
  private watermark = 0;

  ingest(tick: CanonicalConstituentTick): void {
    const now = tick.processedAtMs;
    if (![now, tick.exchangeTimestampMs, tick.receivedAtMs, tick.ltp].every(x => Number.isFinite(x) && x > 0)
      || tick.exchangeTimestampMs > tick.receivedAtMs || tick.receivedAtMs > now || now < this.watermark) return;
    this.watermark = now;
    const currentMinute = Math.floor(now / 60_000) * 60_000;
    if (this.openMinute !== null && this.openMinute < currentMinute) {
      this.closed.push({ minuteStartMs: this.openMinute, closedAtMs: now, immutable: true,
        ticks: [...this.ticks.values()].map(row => ({ ...row })) });
      this.closed = this.closed.slice(-30);
      this.ticks.clear();
      this.openMinute = null;
    }
    // Never revise closed history with late packets or fill empty minute gaps.
    const minute = Math.floor(tick.exchangeTimestampMs / 60_000) * 60_000;
    if (minute !== currentMinute) return;
    const previous = this.ticks.get(tick.instrumentToken);
    if (previous && previous.exchangeTimestampMs >= tick.exchangeTimestampMs) return;
    this.openMinute = minute;
    this.ticks.set(tick.instrumentToken, { ...tick });
  }

  read(): KiteConstituentMinuteRecord[] {
    return this.closed.map(row => ({ ...row, ticks: row.ticks.map(tick => ({ ...tick })) }));
  }
}

export const H1_DIAGNOSTIC_LOG_INTERVAL_MS = 60_000;
export const H1_DIAGNOSTIC_LOG_MAX_KEYS = 4096;

/** Bounds diagnostic writes only; it never gates live packets or decisions. */
export class H1DiagnosticLogCadence {
  private windowStartMs: number | null = null;
  private readonly keys = new Set<string>();
  private admitted = 0;
  private skipped = 0;

  admit(key: string, nowMs = Date.now()): { accepted: boolean; windowStartMs: number | null } {
    if (!key || !Number.isFinite(nowMs) || nowMs < 0) return this.skip();
    const windowStartMs = Math.floor(nowMs / H1_DIAGNOSTIC_LOG_INTERVAL_MS) * H1_DIAGNOSTIC_LOG_INTERVAL_MS;
    // Write time, rather than a quote timestamp, prevents a future-dated packet
    // from opening extra persistence windows. Clock rollback cannot reopen one.
    if (this.windowStartMs !== null && windowStartMs < this.windowStartMs) return this.skip();
    if (this.windowStartMs !== windowStartMs) {
      this.windowStartMs = windowStartMs;
      this.keys.clear();
    }
    if (this.keys.has(key) || this.keys.size >= H1_DIAGNOSTIC_LOG_MAX_KEYS) return this.skip();
    this.keys.add(key);
    this.admitted++;
    return { accepted: true, windowStartMs };
  }

  private skip() {
    this.skipped++;
    return { accepted: false, windowStartMs: this.windowStartMs };
  }

  stats() {
    return {
      intervalMs: H1_DIAGNOSTIC_LOG_INTERVAL_MS,
      maxKeys: H1_DIAGNOSTIC_LOG_MAX_KEYS,
      windowStartMs: this.windowStartMs,
      trackedKeys: this.keys.size,
      admitted: this.admitted,
      skipped: this.skipped,
    };
  }

  clear(): void {
    this.keys.clear();
    this.windowStartMs = null;
    this.admitted = 0;
    this.skipped = 0;
  }
}

export function diagnosticSamplingMetadata(windowStartMs: number) {
  return {
    mode: "FIRST_PER_CONTRACT_WRITE_MINUTE" as const,
    intervalMs: H1_DIAGNOSTIC_LOG_INTERVAL_MS,
    windowBasis: "PROCESS_WRITE_TIME" as const,
    windowStart: new Date(windowStartMs).toISOString(),
    completeTickHistory: false,
  };
}

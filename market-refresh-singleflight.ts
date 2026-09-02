import { createHash } from "node:crypto";

type FlightEntry<T> = {
  promise: Promise<T>;
  reusableUntilMs: number;
};

/**
 * Collapses concurrent work for the same authority into one upstream call.
 * A short success-only reuse window also absorbs back-to-back scheduler/API
 * races without caching failures.
 */
export class KeyedSingleFlight<T> {
  private readonly flights = new Map<string, FlightEntry<T>>();

  run(key: string, task: () => Promise<T>, reuseMs = 0, nowMs = Date.now()): Promise<T> {
    const existing = this.flights.get(key);
    if (existing && (existing.reusableUntilMs === Number.POSITIVE_INFINITY || nowMs < existing.reusableUntilMs)) {
      return existing.promise;
    }
    if (existing) this.flights.delete(key);

    const entry: FlightEntry<T> = {
      promise: Promise.resolve().then(task),
      reusableUntilMs: Number.POSITIVE_INFINITY,
    };
    this.flights.set(key, entry);

    void entry.promise.then(
      () => {
        if (this.flights.get(key) !== entry) return;
        if (reuseMs > 0) entry.reusableUntilMs = Date.now() + reuseMs;
        else this.flights.delete(key);
      },
      () => {
        if (this.flights.get(key) === entry) this.flights.delete(key);
      },
    );

    return entry.promise;
  }
}

/** Hashing keeps broker access tokens out of map keys and diagnostics. */
export function marketAuthorityKey(accessToken: string): string {
  return createHash("sha256").update(accessToken).digest("hex");
}

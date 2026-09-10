import type { CanonicalConstituentTick } from "./canonical-constituent-live-component.js";
import type { CanonicalConstituentTokenEntry } from "./canonical-constituent-token-registry.js";

export const KITE_CONSTITUENT_RUNTIME_BRIDGE_V1 = "KITE_CONSTITUENT_RUNTIME_BRIDGE_V1" as const;

export interface KiteConstituentRuntimeTickInput {
  instrumentToken: number;
  exchangeTimestampMs: number;
  receivedAtMs: number;
  ltp: number;
}

export interface KiteConstituentMinuteRecord {
  minuteStartMs: number;
  closedAtMs: number;
  ticks: CanonicalConstituentTick[];
  immutable: true;
}

export interface KiteConstituentRuntimeBridgeAudit {
  version: typeof KITE_CONSTITUENT_RUNTIME_BRIDGE_V1;
  registryEntryCount: number;
  authorizedTokenCount: number;
  latestTickCount: number;
  closedMinuteCount: number;
  acceptedTickCount: number;
  rejectedTickCount: number;
  rejectionReasons: Record<string, number>;
  readOnly: true;
  opensSocket: false;
  infersMembership: false;
  calculatesDirection: false;
  ranksCandidates: false;
  affectsVerdict: false;
  affectsTelegram: false;
  affectsExecution: false;
  createsOrders: false;
  failClosed: true;
}

function positiveFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function minuteStart(timestampMs: number): number {
  return Math.floor(timestampMs / 60_000) * 60_000;
}

export class KiteConstituentRuntimeBridgeV1 {
  private readonly registry: CanonicalConstituentTokenEntry[];
  private readonly authorizedTokens: Set<number>;
  private readonly latestByToken = new Map<number, CanonicalConstituentTick>();
  private readonly minuteTicks = new Map<number, Map<number, CanonicalConstituentTick>>();
  private readonly closedMinutes = new Map<number, KiteConstituentMinuteRecord>();
  private ingestSeq = 0;
  private acceptedTickCount = 0;
  private rejectedTickCount = 0;
  private readonly rejectionReasons = new Map<string, number>();

  constructor(registry: CanonicalConstituentTokenEntry[]) {
    if (!Array.isArray(registry) || registry.length === 0) throw new Error("CANONICAL_CONSTITUENT_REGISTRY_EMPTY");
    this.registry = registry.map((entry) => ({ ...entry }));
    this.authorizedTokens = new Set(this.registry.map((entry) => entry.instrumentToken));
    if (this.authorizedTokens.size === 0 || [...this.authorizedTokens].some((token) => !Number.isInteger(token) || token <= 0)) {
      throw new Error("CANONICAL_CONSTITUENT_REGISTRY_INVALID_TOKEN");
    }
  }

  private reject(reason: string): { accepted: false; reason: string } {
    this.rejectedTickCount += 1;
    this.rejectionReasons.set(reason, (this.rejectionReasons.get(reason) ?? 0) + 1);
    return { accepted: false, reason };
  }

  publishTick(input: KiteConstituentRuntimeTickInput, processedAtMs = Date.now()): { accepted: boolean; reason: string } {
    if (!Number.isInteger(input?.instrumentToken) || input.instrumentToken <= 0 || !this.authorizedTokens.has(input.instrumentToken)) {
      return this.reject("UNAUTHORIZED_CONSTITUENT_TOKEN");
    }
    if (!positiveFinite(input.exchangeTimestampMs) || !positiveFinite(input.receivedAtMs) || !positiveFinite(processedAtMs) || !positiveFinite(input.ltp)) {
      return this.reject("INVALID_CONSTITUENT_TICK");
    }
    if (input.receivedAtMs < input.exchangeTimestampMs || processedAtMs < input.receivedAtMs) {
      return this.reject("INVALID_CONSTITUENT_TIMESTAMP_ORDER");
    }

    const minute = minuteStart(input.exchangeTimestampMs);
    if (this.closedMinutes.has(minute)) return this.reject("CLOSED_MINUTE_IMMUTABLE");

    const previous = this.latestByToken.get(input.instrumentToken);
    if (previous && input.exchangeTimestampMs < previous.exchangeTimestampMs) return this.reject("OUT_OF_ORDER_CONSTITUENT_TICK");
    if (previous && input.exchangeTimestampMs === previous.exchangeTimestampMs) return this.reject("DUPLICATE_CONSTITUENT_TICK");

    const tick: CanonicalConstituentTick = {
      instrumentToken: input.instrumentToken,
      exchangeTimestampMs: input.exchangeTimestampMs,
      receivedAtMs: input.receivedAtMs,
      processedAtMs,
      ingestSeq: ++this.ingestSeq,
      ltp: input.ltp,
    };
    this.latestByToken.set(input.instrumentToken, tick);
    const bucket = this.minuteTicks.get(minute) ?? new Map<number, CanonicalConstituentTick>();
    bucket.set(input.instrumentToken, tick);
    this.minuteTicks.set(minute, bucket);
    this.acceptedTickCount += 1;
    return { accepted: true, reason: "CONSTITUENT_TICK_ACCEPTED" };
  }

  closeMinute(minuteStartMs: number, closedAtMs: number): KiteConstituentMinuteRecord {
    if (!positiveFinite(minuteStartMs) || minuteStart(minuteStartMs) !== minuteStartMs || !positiveFinite(closedAtMs) || closedAtMs < minuteStartMs + 60_000) {
      throw new Error("INVALID_CONSTITUENT_MINUTE_CLOSE");
    }
    const existing = this.closedMinutes.get(minuteStartMs);
    if (existing) return { ...existing, ticks: existing.ticks.map((tick) => ({ ...tick })) };
    const ticks = [...(this.minuteTicks.get(minuteStartMs)?.values() ?? [])]
      .sort((a, b) => a.instrumentToken - b.instrumentToken)
      .map((tick) => ({ ...tick }));
    const record: KiteConstituentMinuteRecord = { minuteStartMs, closedAtMs, ticks, immutable: true };
    this.closedMinutes.set(minuteStartMs, record);
    this.minuteTicks.delete(minuteStartMs);
    return { ...record, ticks: record.ticks.map((tick) => ({ ...tick })) };
  }

  getLatestTicks(): CanonicalConstituentTick[] {
    return [...this.latestByToken.values()].sort((a, b) => a.instrumentToken - b.instrumentToken).map((tick) => ({ ...tick }));
  }

  getClosedMinute(minuteStartMs: number): KiteConstituentMinuteRecord | null {
    const record = this.closedMinutes.get(minuteStartMs);
    return record ? { ...record, ticks: record.ticks.map((tick) => ({ ...tick })) } : null;
  }

  audit(): KiteConstituentRuntimeBridgeAudit {
    return {
      version: KITE_CONSTITUENT_RUNTIME_BRIDGE_V1,
      registryEntryCount: this.registry.length,
      authorizedTokenCount: this.authorizedTokens.size,
      latestTickCount: this.latestByToken.size,
      closedMinuteCount: this.closedMinutes.size,
      acceptedTickCount: this.acceptedTickCount,
      rejectedTickCount: this.rejectedTickCount,
      rejectionReasons: Object.fromEntries(this.rejectionReasons),
      readOnly: true,
      opensSocket: false,
      infersMembership: false,
      calculatesDirection: false,
      ranksCandidates: false,
      affectsVerdict: false,
      affectsTelegram: false,
      affectsExecution: false,
      createsOrders: false,
      failClosed: true,
    };
  }
}

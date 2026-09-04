import { startH1DynamicReadOnlyLiveChain, type H1DynamicReadOnlyLiveStartResult } from "./h1-dynamic-readonly-live-chain.js";
import type { H1LiveExactReadOnlyWebSocketService } from "./h1-live-exact-readonly-websocket-service.js";
import type { H1LiveExactRawEvidenceMissing, H1LiveExactRawEvidenceSymbolReadiness } from "./h1-live-exact-raw-evidence-store.js";

export const H1_DYNAMIC_READONLY_LIVE_ENV = "H1_DYNAMIC_READONLY_LIVE_ENABLED" as const;

export interface H1DynamicReadOnlyServerStatus {
  version: "H1_DYNAMIC_READONLY_SERVER_BOOTSTRAP_V1";
  enabled: boolean;
  attempted: boolean;
  started: boolean;
  reason: "DISABLED" | H1DynamicReadOnlyLiveStartResult["reason"] | "START_FAILED";
  asOfDate: string | null;
  subscribedTokenCount: number;
  connected: boolean;
  socketState: "READY" | "CONNECTING" | "RECONNECTING" | "OPEN" | "CLOSED" | "ERROR" | "UNAVAILABLE";
  receivedPacketCount: number;
  rejectedPacketCount: number;
  lastPacketTimestamp: string | null;
  rawEvidenceReady: boolean;
  rawEvidenceExpectedTokenCount: number;
  rawEvidenceFreshTokenCount: number;
  rawEvidenceMissingTokenCount: number;
  rawEvidenceStaleTokenCount: number;
  rawEvidenceMissing: H1LiveExactRawEvidenceMissing[];
  rawEvidenceSymbolReadiness: H1LiveExactRawEvidenceSymbolReadiness[];
  greekEvidenceStatus: "NOT_CONFIGURED";
  productionImpact: "NONE";
  readOnly: true;
  forwardsDownstream: false;
  affectsDirection: false;
  affectsVerdict: false;
  affectsExecution: false;
  affectsTelegram: false;
  failClosed: true;
}

type StartFn = (asOfDate: string, enabled: boolean) => Promise<H1DynamicReadOnlyLiveStartResult>;
type StatusService = Pick<H1LiveExactReadOnlyWebSocketService, "status">;

let statusValue: H1DynamicReadOnlyServerStatus = status(false, false, false, "DISABLED", null, 0);
let attemptPromise: Promise<H1DynamicReadOnlyServerStatus> | null = null;
let liveService: StatusService | null = null;

function status(enabled: boolean, attempted: boolean, started: boolean, reason: H1DynamicReadOnlyServerStatus["reason"], asOfDate: string | null, subscribedTokenCount: number): H1DynamicReadOnlyServerStatus {
  return {
    version: "H1_DYNAMIC_READONLY_SERVER_BOOTSTRAP_V1", enabled, attempted, started, reason, asOfDate, subscribedTokenCount,
    connected: false, socketState: "UNAVAILABLE", receivedPacketCount: 0, rejectedPacketCount: 0, lastPacketTimestamp: null,
    rawEvidenceReady: false, rawEvidenceExpectedTokenCount: subscribedTokenCount, rawEvidenceFreshTokenCount: 0,
    rawEvidenceMissingTokenCount: subscribedTokenCount, rawEvidenceStaleTokenCount: 0, rawEvidenceMissing: [], rawEvidenceSymbolReadiness: [],
    greekEvidenceStatus: "NOT_CONFIGURED", productionImpact: "NONE", readOnly: true, forwardsDownstream: false,
    affectsDirection: false, affectsVerdict: false, affectsExecution: false, affectsTelegram: false, failClosed: true,
  };
}

function istDate(now = new Date()): string {
  const shifted = new Date(now.getTime() + (5 * 60 + 30) * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}

export function isH1DynamicReadOnlyLiveEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[H1_DYNAMIC_READONLY_LIVE_ENV]?.trim().toLowerCase() === "true";
}

export function getH1DynamicReadOnlyServerStatus(): H1DynamicReadOnlyServerStatus {
  if (!liveService) return { ...statusValue, rawEvidenceMissing: statusValue.rawEvidenceMissing.map((x) => ({ ...x })), rawEvidenceSymbolReadiness: statusValue.rawEvidenceSymbolReadiness.map((x) => ({ ...x, blockers: [...x.blockers] })) };
  const live = liveService.status();
  return {
    ...statusValue,
    connected: live.connected, socketState: live.state, receivedPacketCount: live.receivedPacketCount,
    rejectedPacketCount: live.rejectedPacketCount, lastPacketTimestamp: live.lastPacketTimestamp,
    rawEvidenceReady: live.rawEvidenceReady, rawEvidenceExpectedTokenCount: live.rawEvidenceExpectedTokenCount,
    rawEvidenceFreshTokenCount: live.rawEvidenceFreshTokenCount, rawEvidenceMissingTokenCount: live.rawEvidenceMissingTokenCount,
    rawEvidenceStaleTokenCount: live.rawEvidenceStaleTokenCount,
    rawEvidenceMissing: (live.rawEvidenceMissing ?? []).map((x) => ({ ...x })),
    rawEvidenceSymbolReadiness: (live.rawEvidenceSymbolReadiness ?? []).map((x) => ({ ...x, blockers: [...x.blockers] })),
    greekEvidenceStatus: live.greekEvidenceStatus, forwardsDownstream: false,
  };
}

function scheduleDelayedLiveProofLog(): void {
  if (process.env.NODE_ENV === "test") return;
  const proofTimer = setTimeout(() => console.log(`[H1_DYNAMIC_READONLY_LIVE_PROOF] ${JSON.stringify(getH1DynamicReadOnlyServerStatus())}`), 5_000);
  proofTimer.unref?.();
}

export async function startH1DynamicReadOnlyLiveFromServerEnv(env: NodeJS.ProcessEnv = process.env, startFn: StartFn = startH1DynamicReadOnlyLiveChain, now = new Date()): Promise<H1DynamicReadOnlyServerStatus> {
  const enabled = isH1DynamicReadOnlyLiveEnabled(env);
  if (!enabled) { liveService = null; statusValue = status(false, false, false, "DISABLED", null, 0); return getH1DynamicReadOnlyServerStatus(); }
  if (attemptPromise) return attemptPromise;
  const asOfDate = istDate(now);
  statusValue = status(true, true, false, "PREPARATION_BLOCKED", asOfDate, 0);
  attemptPromise = (async () => {
    try {
      const live = await startFn(asOfDate, true);
      liveService = live.service;
      statusValue = status(true, true, live.started, live.reason, asOfDate, live.subscribedTokenCount);
      if (live.started && liveService) scheduleDelayedLiveProofLog();
    } catch { liveService = null; statusValue = status(true, true, false, "START_FAILED", asOfDate, 0); }
    return getH1DynamicReadOnlyServerStatus();
  })();
  return attemptPromise;
}

export function resetH1DynamicReadOnlyServerBootstrapForTest(): void {
  if (process.env.NODE_ENV !== "test") throw new Error("H1_SERVER_BOOTSTRAP_RESET_TEST_ONLY");
  attemptPromise = null; liveService = null; statusValue = status(false, false, false, "DISABLED", null, 0);
}

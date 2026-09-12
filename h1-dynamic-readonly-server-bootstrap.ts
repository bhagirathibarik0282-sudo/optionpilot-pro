import { startH1DynamicReadOnlyLiveChain, type H1DynamicReadOnlyLiveStartResult } from "./h1-dynamic-readonly-live-chain.js";
import { getH1RegularMarketWindowContext, type H1RegularMarketWindowContext } from "./h1-regular-market-window-context.js";
import { evaluateH1MarketOpenReadinessAcceptance, type H1MarketOpenReadinessAcceptance } from "./h1-market-open-readiness-acceptance.js";
import { buildH1MarketOpenAcceptanceCapture } from "./h1-market-open-acceptance-capture.js";
import { scheduleH1WeekdayAcceptanceCapture, type H1WeekdayAcceptanceCaptureCancel } from "./h1-weekday-acceptance-capture-scheduler.js";
import { subscribeKiteAuthoritySessionPersisted, type KiteAuthoritySessionPersistedUnsubscribe } from "./kite-session-authority.js";
import type { H1LiveExactReadOnlyConsumerObservation, H1LiveExactReadOnlyDirectionObservation, H1LiveExactReadOnlyShadowInputObservation, H1LiveExactReadOnlyWebSocketService } from "./h1-live-exact-readonly-websocket-service.js";
import type { H1LiveExactRawEvidenceMissing, H1LiveExactRawEvidenceRow, H1LiveExactRawEvidenceSymbolReadiness } from "./h1-live-exact-raw-evidence-store.js";
import type { H1NearestValidMonthlyPeerReadinessRow } from "./h1-nearest-valid-monthly-peer-readiness.js";

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
  nearestPeerReadiness: H1NearestValidMonthlyPeerReadinessRow[];
  readOnlyConsumerReadySymbolCount: number;
  readOnlyConsumerObservations: H1LiveExactReadOnlyConsumerObservation[];
  readOnlyDirectionReadySymbolCount: number;
  readOnlyDirectionObservations: H1LiveExactReadOnlyDirectionObservation[];
  readOnlyShadowInputReadySymbolCount: number;
  readOnlyShadowInputObservations: H1LiveExactReadOnlyShadowInputObservation[];
  selectorRuntimePolicyReady: boolean;
  selectorRuntimeAttached: boolean;
  selectorRuntimeBlockers: string[];
  marketWindowContext: H1RegularMarketWindowContext;
  marketOpenReadinessAcceptance: H1MarketOpenReadinessAcceptance;
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
type StatusService = Pick<H1LiveExactReadOnlyWebSocketService, "status" | "stop" | "rawEvidenceStatus">
  & Partial<Pick<H1LiveExactReadOnlyWebSocketService, "hawkEyeSource">>;
type H1StatusWithoutAcceptance = Omit<H1DynamicReadOnlyServerStatus, "marketOpenReadinessAcceptance">;

let statusValue: H1DynamicReadOnlyServerStatus = status(false, false, false, "DISABLED", null, 0);
let attemptPromise: Promise<H1DynamicReadOnlyServerStatus> | null = null;
let liveService: StatusService | null = null;

/** Pull-only copy from the existing service; never starts a feed or closes a minute. */
export function getHawkEyeLiveSource() {
  return liveService?.hawkEyeSource?.() ?? null;
}
let initialProofTimer: NodeJS.Timeout | null = null;
let threeMinuteProofTimer: NodeJS.Timeout | null = null;
let weekdayAcceptanceCaptureCancel: H1WeekdayAcceptanceCaptureCancel | null = null;
let authoritySessionPersistedUnsubscribe: KiteAuthoritySessionPersistedUnsubscribe | null = null;
let authorityRebindInFlight = false;

function withAcceptance(base: H1StatusWithoutAcceptance): H1DynamicReadOnlyServerStatus {
  return {
    ...base,
    marketOpenReadinessAcceptance: evaluateH1MarketOpenReadinessAcceptance(base),
  };
}

function status(enabled: boolean, attempted: boolean, started: boolean, reason: H1DynamicReadOnlyServerStatus["reason"], asOfDate: string | null, subscribedTokenCount: number): H1DynamicReadOnlyServerStatus {
  const base: H1StatusWithoutAcceptance = {
    version: "H1_DYNAMIC_READONLY_SERVER_BOOTSTRAP_V1", enabled, attempted, started, reason, asOfDate, subscribedTokenCount,
    connected: false, socketState: "UNAVAILABLE", receivedPacketCount: 0, rejectedPacketCount: 0, lastPacketTimestamp: null,
    rawEvidenceReady: false, rawEvidenceExpectedTokenCount: subscribedTokenCount, rawEvidenceFreshTokenCount: 0,
    rawEvidenceMissingTokenCount: subscribedTokenCount, rawEvidenceStaleTokenCount: 0, rawEvidenceMissing: [], rawEvidenceSymbolReadiness: [], nearestPeerReadiness: [],
    readOnlyConsumerReadySymbolCount: 0, readOnlyConsumerObservations: [], readOnlyDirectionReadySymbolCount: 0, readOnlyDirectionObservations: [],
    readOnlyShadowInputReadySymbolCount: 0, readOnlyShadowInputObservations: [],
    selectorRuntimePolicyReady: false, selectorRuntimeAttached: false, selectorRuntimeBlockers: [],
    marketWindowContext: getH1RegularMarketWindowContext(),
    greekEvidenceStatus: "NOT_CONFIGURED", productionImpact: "NONE", readOnly: true, forwardsDownstream: false,
    affectsDirection: false, affectsVerdict: false, affectsExecution: false, affectsTelegram: false, failClosed: true,
  };
  return withAcceptance(base);
}

function istDate(now = new Date()): string {
  const shifted = new Date(now.getTime() + (5 * 60 + 30) * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}

export function isH1DynamicReadOnlyLiveEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[H1_DYNAMIC_READONLY_LIVE_ENV]?.trim().toLowerCase() === "true";
}

export function getH1DynamicReadOnlyServerStatus(): H1DynamicReadOnlyServerStatus {
  if (!liveService) {
    const { marketOpenReadinessAcceptance: _ignored, ...stored } = statusValue;
    const base: H1StatusWithoutAcceptance = {
      ...stored,
      marketWindowContext: getH1RegularMarketWindowContext(),
      rawEvidenceMissing: statusValue.rawEvidenceMissing.map((x) => ({ ...x })),
      rawEvidenceSymbolReadiness: statusValue.rawEvidenceSymbolReadiness.map((x) => ({ ...x, blockers: [...x.blockers] })),
      nearestPeerReadiness: statusValue.nearestPeerReadiness.map((x) => ({ ...x, blockers: [...x.blockers] })),
      readOnlyConsumerObservations: statusValue.readOnlyConsumerObservations.map((x) => ({ ...x, blockers: [...x.blockers] })),
      readOnlyDirectionObservations: statusValue.readOnlyDirectionObservations.map((x) => ({ ...x, blockers: [...x.blockers] })),
      readOnlyShadowInputObservations: statusValue.readOnlyShadowInputObservations.map((x) => ({ ...x, blockers: [...x.blockers] })),
      selectorRuntimeBlockers: [...statusValue.selectorRuntimeBlockers],
    };
    return withAcceptance(base);
  }
  const live = liveService.status();
  const { marketOpenReadinessAcceptance: _ignored, ...stored } = statusValue;
  const base: H1StatusWithoutAcceptance = {
    ...stored,
    marketWindowContext: getH1RegularMarketWindowContext(),
    connected: live.connected, socketState: live.state, receivedPacketCount: live.receivedPacketCount,
    rejectedPacketCount: live.rejectedPacketCount, lastPacketTimestamp: live.lastPacketTimestamp,
    rawEvidenceReady: live.rawEvidenceReady, rawEvidenceExpectedTokenCount: live.rawEvidenceExpectedTokenCount,
    rawEvidenceFreshTokenCount: live.rawEvidenceFreshTokenCount, rawEvidenceMissingTokenCount: live.rawEvidenceMissingTokenCount,
    rawEvidenceStaleTokenCount: live.rawEvidenceStaleTokenCount,
    rawEvidenceMissing: (live.rawEvidenceMissing ?? []).map((x) => ({ ...x })),
    rawEvidenceSymbolReadiness: (live.rawEvidenceSymbolReadiness ?? []).map((x) => ({ ...x, blockers: [...x.blockers] })),
    nearestPeerReadiness: (live.nearestPeerReadiness ?? []).map((x) => ({ ...x, blockers: [...x.blockers] })),
    readOnlyConsumerReadySymbolCount: live.readOnlyConsumerReadySymbolCount ?? 0,
    readOnlyConsumerObservations: (live.readOnlyConsumerObservations ?? []).map((x) => ({ ...x, blockers: [...x.blockers] })),
    readOnlyDirectionReadySymbolCount: live.readOnlyDirectionReadySymbolCount ?? 0,
    readOnlyDirectionObservations: (live.readOnlyDirectionObservations ?? []).map((x) => ({ ...x, blockers: [...x.blockers] })),
    readOnlyShadowInputReadySymbolCount: live.readOnlyShadowInputReadySymbolCount ?? 0,
    readOnlyShadowInputObservations: (live.readOnlyShadowInputObservations ?? []).map((x) => ({ ...x, blockers: [...x.blockers] })),
    selectorRuntimePolicyReady: live.selectorRuntimePolicyReady ?? false,
    selectorRuntimeAttached: live.selectorRuntimeAttached ?? false,
    selectorRuntimeBlockers: [...(live.selectorRuntimeBlockers ?? [])],
    greekEvidenceStatus: live.greekEvidenceStatus, forwardsDownstream: false,
  };
  return withAcceptance(base);
}

/**
 * Pull-only observation boundary for already validated exact FULL-packet option rows.
 * It does not start a socket, mutate the H1 service, or grant selector/execution authority.
 * Missing/stale evidence returns an empty array and downstream consumers must fail closed.
 */
export function getH1DynamicReadOnlyExactOptionRows(nowIso: string = new Date().toISOString()): H1LiveExactRawEvidenceRow[] {
  if (!liveService) return [];
  try {
    return liveService.rawEvidenceStatus(nowIso).rows
      .filter((row) => row.role === "OPTION")
      .map((row) => ({ ...row }));
  } catch {
    return [];
  }
}

function clearLiveProofTimers(): void {
  if (initialProofTimer) clearTimeout(initialProofTimer);
  if (threeMinuteProofTimer) clearTimeout(threeMinuteProofTimer);
  weekdayAcceptanceCaptureCancel?.();
  initialProofTimer = null;
  threeMinuteProofTimer = null;
  weekdayAcceptanceCaptureCancel = null;
}

function clearAuthorityRebindSubscription(): void {
  authoritySessionPersistedUnsubscribe?.();
  authoritySessionPersistedUnsubscribe = null;
  authorityRebindInFlight = false;
}

function logCompactAcceptanceCapture(): void {
  const liveStatus = getH1DynamicReadOnlyServerStatus();
  console.log(`[H1_MARKET_OPEN_ACCEPTANCE_CAPTURE] ${JSON.stringify(buildH1MarketOpenAcceptanceCapture(liveStatus))}`);
}

function scheduleDelayedLiveProofLog(): void {
  if (process.env.NODE_ENV === "test") return;
  clearLiveProofTimers();
  initialProofTimer = setTimeout(() => {
    initialProofTimer = null;
    console.log(`[H1_DYNAMIC_READONLY_LIVE_PROOF] ${JSON.stringify(getH1DynamicReadOnlyServerStatus())}`);
  }, 5_000);
  threeMinuteProofTimer = setTimeout(() => {
    threeMinuteProofTimer = null;
    const liveStatus = getH1DynamicReadOnlyServerStatus();
    console.log(`[H1_DYNAMIC_READONLY_3M_LIVE_PROOF] ${JSON.stringify(liveStatus)}`);
    console.log(`[H1_MARKET_OPEN_ACCEPTANCE_CAPTURE] ${JSON.stringify(buildH1MarketOpenAcceptanceCapture(liveStatus))}`);
  }, 180_000);
  weekdayAcceptanceCaptureCancel = scheduleH1WeekdayAcceptanceCapture(logCompactAcceptanceCapture);
  initialProofTimer.unref?.();
  threeMinuteProofTimer.unref?.();
}

export async function rebindH1DynamicReadOnlyLiveAfterAuthorityPersist(
  env: NodeJS.ProcessEnv = process.env,
  startFn: StartFn = startH1DynamicReadOnlyLiveChain,
  now = new Date(),
): Promise<H1DynamicReadOnlyServerStatus> {
  if (!isH1DynamicReadOnlyLiveEnabled(env)) return getH1DynamicReadOnlyServerStatus();
  const previous = getH1DynamicReadOnlyServerStatus();
  liveService?.stop();
  liveService = null;
  clearLiveProofTimers();
  attemptPromise = null;
  const next = await startH1DynamicReadOnlyLiveFromServerEnv(env, startFn, now);
  if (process.env.NODE_ENV !== "test") {
    console.log(`[H1_DYNAMIC_READONLY_AUTHORITY_REBIND] ${JSON.stringify({
      previousAsOfDate: previous.asOfDate,
      nextAsOfDate: next.asOfDate,
      previousSocketState: previous.socketState,
      nextSocketState: next.socketState,
      nextStarted: next.started,
      productionImpact: "NONE",
      affectsVerdict: false,
      affectsExecution: false,
      affectsTelegram: false,
      failClosed: true,
    })}`);
  }
  return next;
}

function armAuthorityRebindSubscription(): void {
  if (process.env.NODE_ENV === "test" || authoritySessionPersistedUnsubscribe) return;
  authoritySessionPersistedUnsubscribe = subscribeKiteAuthoritySessionPersisted(() => {
    if (authorityRebindInFlight) return;
    authorityRebindInFlight = true;
    void rebindH1DynamicReadOnlyLiveAfterAuthorityPersist().catch(() => undefined).finally(() => {
      authorityRebindInFlight = false;
    });
  });
}

export async function startH1DynamicReadOnlyLiveFromServerEnv(env: NodeJS.ProcessEnv = process.env, startFn: StartFn = startH1DynamicReadOnlyLiveChain, now = new Date()): Promise<H1DynamicReadOnlyServerStatus> {
  const enabled = isH1DynamicReadOnlyLiveEnabled(env);
  if (!enabled) {
    clearLiveProofTimers();
    clearAuthorityRebindSubscription();
    liveService?.stop();
    liveService = null;
    attemptPromise = null;
    statusValue = status(false, false, false, "DISABLED", null, 0);
    return getH1DynamicReadOnlyServerStatus();
  }
  if (attemptPromise) return attemptPromise;
  const asOfDate = istDate(now);
  statusValue = status(true, true, false, "PREPARATION_BLOCKED", asOfDate, 0);
  attemptPromise = (async () => {
    try {
      const live = await startFn(asOfDate, true);
      liveService = live.service;
      statusValue = status(true, true, live.started, live.reason, asOfDate, live.subscribedTokenCount);
      if (live.started && liveService) scheduleDelayedLiveProofLog();
    } catch {
      liveService = null;
      statusValue = status(true, true, false, "START_FAILED", asOfDate, 0);
    }
    armAuthorityRebindSubscription();
    return getH1DynamicReadOnlyServerStatus();
  })();
  return attemptPromise;
}

export function resetH1DynamicReadOnlyServerBootstrapForTest(): void {
  if (process.env.NODE_ENV !== "test") throw new Error("H1_SERVER_BOOTSTRAP_RESET_TEST_ONLY");
  clearLiveProofTimers();
  clearAuthorityRebindSubscription();
  attemptPromise = null;
  liveService = null;
  statusValue = status(false, false, false, "DISABLED", null, 0);
}

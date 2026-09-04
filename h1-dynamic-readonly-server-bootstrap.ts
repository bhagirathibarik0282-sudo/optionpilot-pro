import { startH1DynamicReadOnlyLiveChain, type H1DynamicReadOnlyLiveStartResult } from "./h1-dynamic-readonly-live-chain.js";

export const H1_DYNAMIC_READONLY_LIVE_ENV = "H1_DYNAMIC_READONLY_LIVE_ENABLED" as const;

export interface H1DynamicReadOnlyServerStatus {
  version: "H1_DYNAMIC_READONLY_SERVER_BOOTSTRAP_V1";
  enabled: boolean;
  attempted: boolean;
  started: boolean;
  reason: "DISABLED" | H1DynamicReadOnlyLiveStartResult["reason"] | "START_FAILED";
  asOfDate: string | null;
  subscribedTokenCount: number;
  productionImpact: "NONE";
  readOnly: true;
  affectsDirection: false;
  affectsVerdict: false;
  affectsExecution: false;
  affectsTelegram: false;
  failClosed: true;
}

type StartFn = (asOfDate: string, enabled: boolean) => Promise<H1DynamicReadOnlyLiveStartResult>;

let statusValue: H1DynamicReadOnlyServerStatus = status(false, false, false, "DISABLED", null, 0);
let attemptPromise: Promise<H1DynamicReadOnlyServerStatus> | null = null;

function status(
  enabled: boolean,
  attempted: boolean,
  started: boolean,
  reason: H1DynamicReadOnlyServerStatus["reason"],
  asOfDate: string | null,
  subscribedTokenCount: number,
): H1DynamicReadOnlyServerStatus {
  return {
    version: "H1_DYNAMIC_READONLY_SERVER_BOOTSTRAP_V1",
    enabled,
    attempted,
    started,
    reason,
    asOfDate,
    subscribedTokenCount,
    productionImpact: "NONE",
    readOnly: true,
    affectsDirection: false,
    affectsVerdict: false,
    affectsExecution: false,
    affectsTelegram: false,
    failClosed: true,
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
  return { ...statusValue };
}

/**
 * Server-safe entrypoint. Unless the explicit env flag is exactly true, it does
 * not call the live selection chain and therefore cannot open a Kite socket.
 * The returned/public status intentionally contains no credentials or service
 * handle. A single process may attempt startup at most once.
 */
export async function startH1DynamicReadOnlyLiveFromServerEnv(
  env: NodeJS.ProcessEnv = process.env,
  startFn: StartFn = startH1DynamicReadOnlyLiveChain,
  now = new Date(),
): Promise<H1DynamicReadOnlyServerStatus> {
  const enabled = isH1DynamicReadOnlyLiveEnabled(env);
  if (!enabled) {
    statusValue = status(false, false, false, "DISABLED", null, 0);
    return getH1DynamicReadOnlyServerStatus();
  }
  if (attemptPromise) return attemptPromise;

  const asOfDate = istDate(now);
  statusValue = status(true, true, false, "PREPARATION_BLOCKED", asOfDate, 0);
  attemptPromise = (async () => {
    try {
      const live = await startFn(asOfDate, true);
      statusValue = status(true, true, live.started, live.reason, asOfDate, live.subscribedTokenCount);
    } catch {
      statusValue = status(true, true, false, "START_FAILED", asOfDate, 0);
    }
    return getH1DynamicReadOnlyServerStatus();
  })();
  return attemptPromise;
}

export function resetH1DynamicReadOnlyServerBootstrapForTest(): void {
  if (process.env.NODE_ENV !== "test") throw new Error("H1_SERVER_BOOTSTRAP_RESET_TEST_ONLY");
  attemptPromise = null;
  statusValue = status(false, false, false, "DISABLED", null, 0);
}

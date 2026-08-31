import test from "node:test";
import assert from "node:assert/strict";
import { bindShadowDurableStartupRecoveryRoute } from "../shadow-durable-startup-recovery-hono-binding.js";
import type { ShadowDurableStartupRecoveryRouteProviderInput } from "../shadow-durable-startup-recovery-route-provider.js";

const persistence = {
  journalVersion: "SHADOW_EXECUTION_REPLAY_JOURNAL_V1" as const,
  journalDecision: "RECORD_NEW" as const,
  stableReplayKey: "hono-key-1",
  snapshotVersion: "EXECUTION_CONSISTENCY_SNAPSHOT_V1" as const,
  harnessVersion: "SHADOW_EXECUTION_E2E_HARNESS_V1" as const,
  actionState: "IDLE",
  finalTarget: "NONE",
  resultFingerprint: "fp-hono-1",
  authorizesOrder: false as const,
  brokerOrderAllowed: false as const,
  placesOrder: false as const,
  shadowOnly: true as const,
  failClosed: true as const,
};

function routeResult() {
  return {
    routeVersion: "SHADOW_STARTUP_RECOVERY_READONLY_ROUTE_V1" as const,
    routeAccepted: true,
    method: "GET" as const,
    path: "/api/shadow/startup-recovery" as const,
    routeSideEffectsAllowed: false as const,
    version: "SHADOW_STARTUP_RECOVERY_OBSERVABILITY_V1" as const,
    accepted: true,
    httpStatus: 200,
    contentType: "application/json; charset=utf-8" as const,
    cacheControl: "no-store" as const,
    body: "{}",
    readOnly: true as const,
    diagnosticOnly: true as const,
    loggingSideEffectAllowed: false as const,
    startupSideEffectsAllowed: false as const,
    newEntryResumeAllowed: false as const,
    authorizesOrder: false as const,
    brokerOrderAllowed: false as const,
    placesOrder: false as const,
    shadowOnly: true as const,
    failClosed: true as const,
  };
}

test("binds fixed GET path and builds only durable provider input", async () => {
  let handler: ((context: unknown) => unknown) | null = null;
  const app = { get(path: string, fn: (context: unknown) => unknown) { assert.equal(path, "/api/shadow/startup-recovery"); handler = fn; } } as any;
  let seen: ShadowDurableStartupRecoveryRouteProviderInput | null = null;
  const bound = bindShadowDurableStartupRecoveryRoute(app, async () => ({
    executionId: "exec-hono-1",
    persistence,
    observedAt: "2026-08-31T09:20:00.000Z",
    startupFactsFresh: true,
  }), async (input) => { seen = input; return routeResult(); });
  assert.equal(bound.accepted, true);
  assert.equal(bound.bound, true);
  assert.ok(handler);
  const response: any = await (handler as any)({});
  assert.equal(response.httpStatus, 200);
  assert.equal(seen?.executionId, "exec-hono-1");
  assert.equal((seen as any)?.report, undefined);
  assert.equal((seen as any)?.brokerRecovery, undefined);
  assert.equal(seen?.placesOrder, false);
  assert.equal(seen?.newEntryResumeAllowed, undefined);
});

test("context factory exception returns fail-closed 503", async () => {
  let handler: ((context: unknown) => unknown) | null = null;
  const app = { get(_path: string, fn: (context: unknown) => unknown) { handler = fn; } } as any;
  const bound = bindShadowDurableStartupRecoveryRoute(app, async () => { throw new Error("boom"); });
  assert.equal(bound.accepted, true);
  assert.ok(handler);
  const response: any = await (handler as any)({});
  assert.equal(response.httpStatus, 503);
  assert.match(response.body, /DURABLE_HONO_REQUEST_BUILD_FAILED/);
  assert.equal(response.placesOrder, false);
});

test("invalid app or provider dependency blocks binding", () => {
  const facts = async () => ({ executionId: "x", persistence, observedAt: "2026-08-31T09:20:00.000Z", startupFactsFresh: true });
  assert.equal(bindShadowDurableStartupRecoveryRoute({} as any, facts).bound, false);
  assert.equal(bindShadowDurableStartupRecoveryRoute({ get() {} } as any, facts, null as any).bound, false);
});

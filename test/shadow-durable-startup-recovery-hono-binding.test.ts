import test from "node:test";
import assert from "node:assert/strict";
import { bindShadowDurableStartupRecoveryRoute } from "../shadow-durable-startup-recovery-hono-binding.js";

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

test("binds fixed GET path with sealed durable provider", () => {
  let handler: ((context: unknown) => unknown) | null = null;
  const app = {
    get(path: string, fn: (context: unknown) => unknown) {
      assert.equal(path, "/api/shadow/startup-recovery");
      handler = fn;
    },
  } as any;

  const bound = bindShadowDurableStartupRecoveryRoute(app, async () => ({
    executionId: "exec-hono-1",
    persistence,
    observedAt: "2026-08-31T09:20:00.000Z",
    startupFactsFresh: true,
  }));

  assert.equal(bound.accepted, true);
  assert.equal(bound.bound, true);
  assert.ok(handler);
  assert.equal(bound.authorizesOrder, false);
  assert.equal(bound.brokerOrderAllowed, false);
  assert.equal(bound.placesOrder, false);
});

test("composition-time provider override argument is ignored and never executed", async () => {
  let handler: ((context: unknown) => unknown) | null = null;
  let maliciousProviderCalls = 0;
  const app = { get(_path: string, fn: (context: unknown) => unknown) { handler = fn; } } as any;
  const bindAny = bindShadowDurableStartupRecoveryRoute as any;

  const bound = bindAny(
    app,
    async () => { throw new Error("factory-failure"); },
    async () => {
      maliciousProviderCalls += 1;
      return { httpStatus: 200, placesOrder: true };
    },
  );

  assert.equal(bound.accepted, true);
  assert.ok(handler);
  const response: any = await (handler as any)({});
  assert.equal(response.httpStatus, 503);
  assert.equal(maliciousProviderCalls, 0);
  assert.equal(response.placesOrder, false);
  assert.match(response.body, /DURABLE_HONO_REQUEST_BUILD_FAILED/);
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

test("invalid app or facts factory blocks binding", () => {
  const facts = async () => ({ executionId: "x", persistence, observedAt: "2026-08-31T09:20:00.000Z", startupFactsFresh: true });
  assert.equal(bindShadowDurableStartupRecoveryRoute({} as any, facts).bound, false);
  assert.equal(bindShadowDurableStartupRecoveryRoute({ get() {} } as any, null as any).bound, false);
});

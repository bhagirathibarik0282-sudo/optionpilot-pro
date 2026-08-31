import test from "node:test";
import assert from "node:assert/strict";
import { bindShadowStartupRecoveryReadonlyRoute } from "../shadow-startup-recovery-hono-binding-adapter.js";

const registration = {
  version: "SHADOW_STARTUP_RECOVERY_ROUTE_REGISTRATION_V1" as const,
  method: "GET" as const,
  path: "/api/shadow/startup-recovery" as const,
  readOnly: true as const,
  diagnosticOnly: true as const,
  registrationSideEffectsAllowed: false as const,
  startupSideEffectsAllowed: false as const,
  newEntryResumeAllowed: false as const,
  authorizesOrder: false as const,
  brokerOrderAllowed: false as const,
  placesOrder: false as const,
  shadowOnly: true as const,
  failClosed: true as const,
};

const requestFactory = () => ({
  method: "GET" as const,
  path: "/api/shadow/startup-recovery" as const,
  report: {} as any,
  readOnly: true as const,
  authorizesOrder: false as const,
  brokerOrderAllowed: false as const,
  placesOrder: false as const,
  shadowOnly: true as const,
  failClosed: true as const,
});

test("binds fixed GET route without enabling authority", () => {
  let boundPath = "";
  const app = { get(path: any, _handler: any) { boundPath = path; } };
  const result = bindShadowStartupRecoveryReadonlyRoute(app, registration, requestFactory);
  assert.equal(result.accepted, true);
  assert.equal(result.bound, true);
  assert.equal(boundPath, "/api/shadow/startup-recovery");
  assert.equal(result.authorizesOrder, false);
  assert.equal(result.placesOrder, false);
  assert.equal(result.newEntryResumeAllowed, false);
});

test("invalid app fails closed", () => {
  const result = bindShadowStartupRecoveryReadonlyRoute({} as any, registration, requestFactory);
  assert.equal(result.accepted, false);
  assert.deepEqual(result.reasonCodes, ["INVALID_HONO_APP"]);
});

test("invalid request factory fails closed", () => {
  const app = { get() {} } as any;
  const result = bindShadowStartupRecoveryReadonlyRoute(app, registration, null as any);
  assert.equal(result.accepted, false);
  assert.deepEqual(result.reasonCodes, ["INVALID_ROUTE_REQUEST_FACTORY"]);
});

test("rejected registration does not bind", () => {
  let calls = 0;
  const app = { get() { calls += 1; } } as any;
  const result = bindShadowStartupRecoveryReadonlyRoute(app, { ...registration, method: "POST" as any }, requestFactory);
  assert.equal(result.accepted, false);
  assert.equal(calls, 0);
  assert.deepEqual(result.reasonCodes, ["ROUTE_REGISTRATION_METHOD_NOT_ALLOWED"]);
});

test("binding exception fails closed", () => {
  const app = { get() { throw new Error("boom"); } } as any;
  const result = bindShadowStartupRecoveryReadonlyRoute(app, registration, requestFactory);
  assert.equal(result.accepted, false);
  assert.equal(result.bound, false);
  assert.deepEqual(result.reasonCodes, ["HONO_ROUTE_BINDING_FAILED"]);
  assert.equal(result.brokerOrderAllowed, false);
});

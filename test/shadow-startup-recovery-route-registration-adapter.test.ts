import test from "node:test";
import assert from "node:assert/strict";
import { buildShadowStartupRecoveryRouteRegistration } from "../shadow-startup-recovery-route-registration-adapter.js";

const base = () => ({
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
});

test("accepts exact GET read-only registration contract", () => {
  const result = buildShadowStartupRecoveryRouteRegistration(base());
  assert.equal(result.accepted, true);
  assert.equal(result.method, "GET");
  assert.equal(result.path, "/api/shadow/startup-recovery");
  assert.equal(typeof result.registration?.handler, "function");
  assert.equal(result.registrationSideEffectsAllowed, false);
  assert.equal(result.newEntryResumeAllowed, false);
  assert.equal(result.authorizesOrder, false);
  assert.equal(result.brokerOrderAllowed, false);
  assert.equal(result.placesOrder, false);
});

test("blocks invalid registration version", () => {
  const result = buildShadowStartupRecoveryRouteRegistration({ ...base(), version: "BAD" as never });
  assert.equal(result.accepted, false);
  assert.deepEqual(result.reasonCodes, ["INVALID_ROUTE_REGISTRATION_VERSION"]);
  assert.equal(result.registration, null);
});

test("blocks non-GET registration", () => {
  const result = buildShadowStartupRecoveryRouteRegistration({ ...base(), method: "POST" as never });
  assert.equal(result.accepted, false);
  assert.deepEqual(result.reasonCodes, ["ROUTE_REGISTRATION_METHOD_NOT_ALLOWED"]);
});

test("blocks wrong route path", () => {
  const result = buildShadowStartupRecoveryRouteRegistration({ ...base(), path: "/api/live/order" as never });
  assert.equal(result.accepted, false);
  assert.deepEqual(result.reasonCodes, ["ROUTE_REGISTRATION_PATH_MISMATCH"]);
});

test("blocks invariant tampering and never grants authority", () => {
  const result = buildShadowStartupRecoveryRouteRegistration({ ...base(), authorizesOrder: true as never });
  assert.equal(result.accepted, false);
  assert.deepEqual(result.reasonCodes, ["ROUTE_REGISTRATION_INVARIANT_VIOLATED"]);
  assert.equal(result.registrationSideEffectsAllowed, false);
  assert.equal(result.startupSideEffectsAllowed, false);
  assert.equal(result.newEntryResumeAllowed, false);
  assert.equal(result.authorizesOrder, false);
  assert.equal(result.brokerOrderAllowed, false);
  assert.equal(result.placesOrder, false);
});

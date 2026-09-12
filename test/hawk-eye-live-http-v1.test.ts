import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Hono } from "hono";
import { CanonicalConstituentTickStore } from "../canonical-constituent-tick-store.js";
import { mountHawkEyeLiveRoute } from "../hawk-eye-live-http-v1.js";

const base = Date.UTC(2026, 8, 11, 4);
const registry = [{ instrumentToken: 101, parentSymbol: "NIFTY" as const,
  role: "HEAVYWEIGHT" as const, tradingsymbol: "HDFCBANK", sector: "BANK", weight: null,
  source: "KITE_INSTRUMENT_MASTER" as const }];
function ingest(store: CanonicalConstituentTickStore, i: number, price = 100 + i) {
  const t = base + i * 60_000 + 50_000;
  return store.ingest({mode: "full", instrumentToken: 101, exchangeTimestamp: new Date(t).toISOString(),
    lastPrice: price, isIndex: false}, new Date(t + 10).toISOString(), t + 20);
}
function setup(count = 17) {
  const store = new CanonicalConstituentTickStore(registry);
  for (let i = 0; i < count; i++) ingest(store, i);
  const app = new Hono();
  mountHawkEyeLiveRoute(app, () => store.hawkEyeSource(), () => base + (count - 1) * 60_000 + 51_000);
  return {store, app};
}
const route = "/api/research/hawk-eye-live-shadow";

test("real store ingest -> closed minutes -> HTTP features, with no candidate authority", async () => {
  const {store, app} = setup();
  const before = store.status();
  const response = await app.request(route);
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(data.report.inputClosedMinuteCount, 16);
  assert.deepEqual(data.report.observation.features.map((f: any) => f.windowMinutes), [3, 6, 15]);
  assert.equal(data.state, "PARTIAL");
  assert.equal(data.candidate, null);
  assert.equal(data.probability, null);
  for (const key of ["affectsSelector", "affectsVerdict", "affectsTelegram", "affectsExecution", "createsOrders", "calibratedEdgeProven", "survivesRestart"]) assert.equal(data[key], false);
  assert.equal(data.bankniftyContextOnly, true);
  assert.deepEqual(store.status(), before);
  assert.deepEqual(await (await app.request(route)).json(), data);
  assert.equal((await app.request(route, {method: "POST"})).status, 404);
});

test("history excludes open minute, copies data, preserves memberships and is bounded", () => {
  const {store} = setup(80);
  const source = store.hawkEyeSource();
  assert.equal(source.constituentMinutes.length, 30);
  assert.ok(source.constituentMinutes.every(r => r.immutable && r.closedAtMs >= r.minuteStartMs + 60_000));
  assert.equal(source.constituentMinutes.at(-1)!.minuteStartMs, base + 78 * 60_000);
  source.constituentMinutes[0].ticks[0].ltp = -1;
  source.registry[0].tradingsymbol = "BAD";
  assert.ok(store.hawkEyeSource().constituentMinutes[0].ticks[0].ltp > 0);
  assert.equal(store.hawkEyeSource().registry[0].tradingsymbol, "HDFCBANK");
});

test("late, duplicate and invalid packets do not rewrite closed history", () => {
  const {store} = setup(4);
  const before = store.hawkEyeSource();
  assert.equal(ingest(store, 1), false);
  assert.equal(ingest(store, 3, 999), true); // Existing latest-tick semantics stay unchanged.
  assert.equal(ingest(store, 4, 0), false);
  assert.deepEqual(store.hawkEyeSource(), before);
  ingest(store, 4);
  assert.equal(store.hawkEyeSource().constituentMinutes.at(-1)!.ticks[0].ltp, 103);
});

test("missing source and warmup never invent features", async () => {
  const app = new Hono();
  mountHawkEyeLiveRoute(app, () => null);
  assert.equal((await (await app.request(route)).json()).blocker, "LIVE_CONSTITUENT_REGISTRY_NOT_AVAILABLE");
  const warm = setup(1);
  const d = await (await warm.app.request(route)).json();
  assert.equal(d.blocker, "CLOSED_MINUTE_HISTORY_WARMING");
  assert.equal(d.report.observation.features.length, 0);
});

test("stale source and thrown source fail closed without error detail leakage", async () => {
  const {store} = setup();
  const stale = new Hono();
  mountHawkEyeLiveRoute(stale, () => store.hawkEyeSource(), () => base + 100 * 60_000);
  assert.equal((await (await stale.request(route)).json()).report.observation.features.length, 0);
  const broken = new Hono();
  mountHawkEyeLiveRoute(broken, () => { throw new Error("secret-provider-detail"); });
  const response = await broken.request(route);
  assert.equal(response.status, 503);
  assert.ok(!(await response.text()).includes("secret-provider-detail"));
});

test("day gaps are not filled and lower processing time cannot revise history", () => {
  const {store} = setup(2);
  ingest(store, 1440);
  assert.equal(store.hawkEyeSource().constituentMinutes.length, 2);
  const before = store.hawkEyeSource();
  ingest(store, 3);
  assert.deepEqual(store.hawkEyeSource(), before);
});

test("route is connected to existing service without a runtime text mutator", () => {
  const read = (name: string) => readFileSync(new URL(`../${name}`, import.meta.url), "utf8");
  assert.ok(read("research-server-hook.ts").includes("mountHawkEyeLiveRoute(app, getHawkEyeLiveSource)"));
  assert.ok(read("h1-dynamic-readonly-server-bootstrap.ts").includes("liveService?.hawkEyeSource?.() ?? null"));
  assert.ok(read("h1-live-exact-readonly-websocket-service.ts").includes("this.constituentEvidence?.hawkEyeSource() ?? null"));
  assert.doesNotMatch(read("hawk-eye-live-http-v1.ts"), /setInterval|fetch\(|sendMessage|\.query\(/);
});

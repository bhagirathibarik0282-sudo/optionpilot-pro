import test from "node:test";
import assert from "node:assert/strict";
import { ImmediateEventTruthRecorder } from "../immediate-event-truth-recorder.js";
import { ImmediateMetricIngestBridge } from "../immediate-metric-ingest-bridge.js";
import { KiteWebSocketImmediateFeed } from "../kite-websocket-immediate-feed.js";
import { decodeKitePacket } from "../kite-websocket-binary-decoder.js";
import { KiteWebSocketTransport } from "../kite-websocket-transport.js";

function feed() {
  const truth = new ImmediateEventTruthRecorder();
  return { truth, feed: new KiteWebSocketImmediateFeed(new ImmediateMetricIngestBridge(truth)) };
}

function tick(value: number, n: number) {
  return {
    transportSource: "KITE_WEBSOCKET" as const,
    symbol: "NIFTY" as const,
    instrumentToken: 12345,
    instrumentLabel: "NIFTY26SEP24000CE",
    occurredAt: new Date(Date.UTC(2026, 7, 31, 6, 0, n)).toISOString(),
    receivedAt: new Date(Date.UTC(2026, 7, 31, 6, 0, n, 100)).toISOString(),
    snapshotId: `ws-${n}`,
    lockedTrendSide: "CE" as const,
    freshnessVerified: true,
    updates: [{
      family: "CE_PREMIUM" as const,
      metric: "last_price",
      value,
      effectWhenRising: "FAVOURS_CE" as const,
      effectWhenFalling: "FAVOURS_PE" as const,
    }],
  };
}

test("rejects non-Kite-WebSocket provenance", () => {
  const { feed: wsFeed } = feed();
  const bad = { ...tick(100, 0), transportSource: "REST" } as any;
  assert.throws(() => wsFeed.ingestTick(bad), /IMMEDIATE_FEED_REQUIRES_KITE_WEBSOCKET/);
});

test("preserves exact Kite WebSocket source and does not allow REST fallback", () => {
  const { feed: wsFeed } = feed();
  const result = wsFeed.ingestTick(tick(100, 0));
  assert.equal(result.source, "KITE_WEBSOCKET");
  assert.equal(result.instrumentToken, 12345);
  assert.equal(result.occurredAt, tick(100, 0).occurredAt);
  assert.equal(result.restFallbackAllowed, false);
  assert.equal(result.affectsVerdict, false);
  assert.equal(result.affectsExecution, false);
  assert.equal(result.affectsTelegram, false);
});

test("warms up per instrument metric and persists only abnormal WebSocket event", () => {
  const { truth, feed: wsFeed } = feed();
  const values = [100, 100.2, 100.1, 100.3, 100.2, 100.4, 100.3, 100.5, 115];
  let last;
  values.forEach((value, i) => { last = wsFeed.ingestTick(tick(value, i)); });
  const detector = (last as ReturnType<typeof wsFeed.ingestTick>).results[0].detector;
  assert.equal(detector.abnormal, true);
  assert.equal(detector.event?.alignment, "FAVOURS_TREND");
  const rows = truth.list("NIFTY", 10);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].source, "KITE_WEBSOCKET");
  assert.equal(rows[0].event.family, "CE_PREMIUM");
});

test("stale WebSocket update can be detected but is not marked fresh", () => {
  const { feed: wsFeed } = feed();
  let last;
  const values = [100, 100.2, 100.1, 100.3, 100.2, 100.4, 100.3, 100.5];
  values.forEach((value, i) => { last = wsFeed.ingestTick(tick(value, i)); });
  const staleTick = { ...tick(115, 20), freshnessVerified: false };
  last = wsFeed.ingestTick(staleTick);
  assert.equal(last.results[0].detector.event?.fresh, false);
});

test("official Kite full packet fields decode from binary", () => {
  const bytes = new Uint8Array(184);
  const view = new DataView(bytes.buffer);
  view.setInt32(0, 123456, false);
  view.setInt32(4, 13220, false);
  view.setInt32(48, 987654, false);
  view.setInt32(60, 1700000000, false);
  const decoded = decodeKitePacket(bytes);
  assert.equal(decoded.mode, "full");
  assert.equal(decoded.lastPrice, 132.2);
  assert.equal(decoded.oi, 987654);
  assert.equal(decoded.exchangeTimestamp, new Date(1700000000000).toISOString());
});

test("transport subscribes Kite tokens in full mode", () => {
  const sent: string[] = [];
  const listeners = new Map<string, (event:any)=>void>();
  const socket = {
    binaryType: "",
    readyState: 1,
    send: (s:string) => sent.push(s),
    close: () => {},
    addEventListener: (type:any, fn:any) => listeners.set(type, fn),
  };
  let url = "";
  const transport = new KiteWebSocketTransport({
    apiKey: "key", accessToken: "token", instrumentTokens: [256265],
    socketFactory: (u) => { url = u; return socket; }, onTicks: () => {},
  });
  transport.connect();
  listeners.get("open")?.({});
  assert.match(url, /^wss:\/\/ws\.kite\.trade\?/);
  assert.deepEqual(JSON.parse(sent[0]), { a: "subscribe", v: [256265] });
  assert.deepEqual(JSON.parse(sent[1]), { a: "mode", v: ["full", [256265]] });
});

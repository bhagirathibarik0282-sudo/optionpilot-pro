import test from "node:test";
import assert from "node:assert/strict";
import { KiteWebSocketTransport } from "../kite-websocket-transport.js";

class FakeSocket {
  binaryType = "";
  readyState = 1;
  sent: string[] = [];
  closed = false;
  listeners = new Map<string, Array<(event: any) => void>>();
  send(data: string) { this.sent.push(data); }
  close() { this.closed = true; this.emit("close", {}); }
  addEventListener(type: "open" | "message" | "error" | "close", listener: (event: any) => void) {
    const rows = this.listeners.get(type) ?? [];
    rows.push(listener); this.listeners.set(type, rows);
  }
  emit(type: string, event: any) { for (const fn of this.listeners.get(type) ?? []) fn(event); }
}

test("connects only to Kite endpoint and subscribes full mode", () => {
  const socket = new FakeSocket();
  let url = "";
  const states: string[] = [];
  const transport = new KiteWebSocketTransport({
    apiKey: "key",
    accessToken: "token",
    instrumentTokens: [256265, 123456],
    socketFactory: (u) => { url = u; return socket; },
    onTicks: () => {},
    onState: (s) => states.push(s),
  });
  transport.connect();
  socket.emit("open", {});
  assert.match(url, /^wss:\/\/ws\.kite\.trade\?api_key=key&access_token=token$/);
  assert.deepEqual(JSON.parse(socket.sent[0]), { a: "subscribe", v: [256265, 123456] });
  assert.deepEqual(JSON.parse(socket.sent[1]), { a: "mode", v: ["full", [256265, 123456]] });
  assert.deepEqual(states, ["CONNECTING", "OPEN"]);
});

test("rejects duplicate or oversized subscriptions", () => {
  assert.throws(() => new KiteWebSocketTransport({ apiKey:"k", accessToken:"t", instrumentTokens:[1,1], onTicks:()=>{} }), /DUPLICATE/);
  assert.throws(() => new KiteWebSocketTransport({ apiKey:"k", accessToken:"t", instrumentTokens:Array.from({length:3001},(_,i)=>i+1), onTicks:()=>{} }), /LIMIT/);
});

test("routes text messages without treating them as market ticks", () => {
  const socket = new FakeSocket();
  const text: string[] = [];
  let tickCalls = 0;
  const transport = new KiteWebSocketTransport({
    apiKey:"k", accessToken:"t", instrumentTokens:[1], socketFactory:()=>socket,
    onTicks:()=>{tickCalls++;}, onTextMessage:(s)=>{text.push(s);}
  });
  transport.connect();
  socket.emit("message", { data: '{"type":"order"}' });
  assert.deepEqual(text, ['{"type":"order"}']);
  assert.equal(tickCalls, 0);
});

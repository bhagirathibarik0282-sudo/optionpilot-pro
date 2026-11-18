/** Optional same-process tap of the EXISTING trading feed. No socket or child spawn. */
import type { Writable } from 'node:stream';
import type { KiteDecodedPacket } from '../kite-websocket-binary-decoder.js';

type Context = { symbol: 'BANKNIFTY'; spot_ltp: number; vwap: number; spot_ts: string; vwap_ts: string };
type Observer = (ticks: KiteDecodedPacket[], receivedAt: string) => void;
type Config = {
  enabled?: boolean;
  writer: Writable;
  registerObserver: (observer: Observer) => () => void;
  contractFor: (token: number) => { instrument_token: number; tradingsymbol: string } | null;
  contextFor: (token: number) => Context | null;
  now?: () => number;
};

function awareMs(value: unknown): number {
  if (typeof value !== 'string' || !/(Z|[+-]\d\d:\d\d)$/.test(value)) return NaN;
  return Date.parse(value);
}
function positive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

export function installBnfShadowFeedRelay(config: Config) {
  const status = { installed: false, stopped: false, accepted: 0, rejected: 0, backpressureDrops: 0,
    blocked: false, fault: null as string | null, createsOrders: false as const, extraBrokerConnections: 0 as const };
  let unregister: (() => void) | null = null;
  const fail = (code: string) => { status.fault = code; status.stopped = true; unregister?.(); unregister = null; };
  const drain = () => { status.blocked = false; };
  const error = () => fail('SINK_ERROR');
  const close = () => fail('SINK_CLOSED');
  const stop = () => {
    status.stopped = true; unregister?.(); unregister = null;
    config.writer.off('drain', drain); config.writer.off('error', error); config.writer.off('close', close);
    // Sink belongs to the caller. Do not end stdin or kill its worker here.
  };
  const result = { status: () => ({ ...status }), stop };
  if (config.enabled !== true) return result;
  config.writer.on('drain', drain); config.writer.on('error', error); config.writer.on('close', close);
  const observer: Observer = (ticks, receivedAt) => {
    if (status.stopped) return;
    for (const packet of ticks) {
      try {
        if (status.blocked || config.writer.writableLength >= 65536) { status.backpressureDrops++; continue; }
        if (config.writer.destroyed || config.writer.writableEnded) { fail('SINK_CLOSED'); break; }
        const now = config.now?.() ?? Date.now();
        const receive = awareMs(receivedAt), exchange = awareMs(packet.exchangeTimestamp);
        const contract = config.contractFor(packet.instrumentToken), context = config.contextFor(packet.instrumentToken);
        if (!Number.isFinite(now) || !Number.isFinite(receive) || !Number.isFinite(exchange) ||
            receive > now || now - receive > 5000 || exchange > receive || now - exchange > 5000 ||
            packet.mode !== 'full' || packet.isIndex !== false || !positive(packet.lastPrice) ||
            !Number.isInteger(packet.instrumentToken) || packet.instrumentToken <= 0 ||
            !contract || contract.instrument_token !== packet.instrumentToken ||
            typeof contract.tradingsymbol !== 'string' || !contract.tradingsymbol.startsWith('BANKNIFTY') ||
            !context || context.symbol !== 'BANKNIFTY' || !positive(context.spot_ltp) || !positive(context.vwap)) {
          status.rejected++; continue;
        }
        if ([context.spot_ts, context.vwap_ts].some(ts => {
          const ms = awareMs(ts);
          return !Number.isFinite(ms) || ms > receive || now - ms > 5000;
        })) { status.rejected++; continue; }
        const depth = packet.marketDepth;
        if (!depth || ![depth.buy, depth.sell].every(levels => Array.isArray(levels) && levels.length === 5 &&
          levels.every(l => typeof l.price === 'number' && Number.isFinite(l.price) && l.price >= 0 &&
            Number.isInteger(l.quantity) && l.quantity >= 0 && Number.isInteger(l.orders) && l.orders >= 0))) {
          status.rejected++; continue;
        }
        // Allowlist fields. Never serialize the caller's object, session or credentials.
        const line = JSON.stringify({ type: 'kite_depth', tradingsymbol: contract.tradingsymbol, receive_ts: receivedAt,
          packet: { mode: packet.mode, isIndex: packet.isIndex, instrumentToken: packet.instrumentToken,
            lastPrice: packet.lastPrice, exchangeTimestamp: packet.exchangeTimestamp,
            marketDepth: { buy: depth.buy.map(l => ({ price: l.price, quantity: l.quantity, orders: l.orders })),
              sell: depth.sell.map(l => ({ price: l.price, quantity: l.quantity, orders: l.orders })) } },
          market_context: { symbol: context.symbol, spot_ltp: context.spot_ltp, vwap: context.vwap,
            spot_ts: context.spot_ts, vwap_ts: context.vwap_ts } })+'\n';
        if (Buffer.byteLength(line) > 32768) { status.rejected++; continue; }
        const writable = config.writer.write(line);
        status.accepted++;
        // write(false) already accepted this line. Never retry it after drain.
        if (!writable) status.blocked = true;
      } catch { status.rejected++; fail('RELAY_CALLBACK_FAILED'); break; }
    }
  };
  try { unregister = config.registerObserver(observer); status.installed = true; }
  catch { fail('OBSERVER_REGISTRATION_FAILED'); }
  return result;
}

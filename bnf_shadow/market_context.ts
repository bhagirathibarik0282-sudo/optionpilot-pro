/** Fresh reference cache for the unchanged legacy spot-vs-near-futures rule. */
import { installBnfShadowFeedRelay } from './feed_relay.ts';
import type { KiteDecodedPacket } from '../kite-websocket-binary-decoder.js';
import type { KiteImmediateTokenEntry } from '../kite-immediate-token-registry.js';
import type { Writable } from 'node:stream';

const BASIS = 'NEAR_FUTURES_AVERAGE_PRICE' as const;
const POLICY = 'LEGACY_SPOT_VS_NEAR_FUTURES_AVERAGE' as const;
function time(value: unknown) {
  return typeof value === 'string' && /(Z|[+-]\d\d:\d\d)$/.test(value) ? Date.parse(value) : NaN;
}
function istDate(ms: number) { return new Date(ms + 19800000).toISOString().slice(0, 10); }
function positive(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) && value > 0; }

type Observation = { value: number; exchange: number; received: number };
export class BnfMarketReferenceCache {
  private spot: Observation | null = null;
  private future: Observation | null = null;
  private spotEntry: KiteImmediateTokenEntry;
  private futureEntry: KiteImmediateTokenEntry;
  private masterDate: string;
  private connected: () => boolean;
  private now: () => number;

  constructor(entries: KiteImmediateTokenEntry[], masterDate: string, connected: () => boolean, now = Date.now) {
    this.now = now; this.connected = connected; this.masterDate = masterDate;
    if (masterDate !== istDate(now())) throw Error('CURRENT_MASTER_DATE_REQUIRED');
    const bnf = entries.filter(e => e.symbol === 'BANKNIFTY');
    const spots = bnf.filter(e => e.role === 'SPOT');
    const futures = bnf.filter(e => e.role === 'FUTURE');
    if (spots.length !== 1 || !futures.length || futures.some(e =>
      !e.expiry || !/^\d{4}-\d{2}-\d{2}$/.test(e.expiry) ||
      !Number.isFinite(Date.parse(e.expiry+'T00:00:00Z')) ||
      new Date(e.expiry+'T00:00:00Z').toISOString().slice(0, 10) !== e.expiry)) throw Error('REFERENCE_IDENTITY_REQUIRED');
    const eligible = futures.filter(e => e.expiry! >= masterDate).sort((a,b) => a.expiry!.localeCompare(b.expiry!));
    if (!eligible.length || eligible.filter(e => e.expiry === eligible[0].expiry).length !== 1) throw Error('UNAMBIGUOUS_NEAR_FUTURE_REQUIRED');
    this.spotEntry = { ...spots[0] }; this.futureEntry = { ...eligible[0] };
    for (const entry of [this.spotEntry, this.futureEntry]) {
      if (!Number.isInteger(entry.instrumentToken) || entry.instrumentToken <= 0 || !entry.instrumentLabel?.trim()) throw Error('INVALID_REFERENCE_IDENTITY');
    }
    if (this.spotEntry.instrumentToken === this.futureEntry.instrumentToken) throw Error('REFERENCE_TOKEN_COLLISION');
  }

  clear() { this.spot = null; this.future = null; }

  ingest(ticks: KiteDecodedPacket[], receivedAt: string) {
    const now = this.now(), received = time(receivedAt);
    if (!this.connected() || istDate(now) !== this.masterDate) { this.clear(); return; }
    if (!Number.isFinite(received) || received > now || now - received > 5000) return;
    for (const packet of ticks) {
      const role = packet.instrumentToken === this.spotEntry.instrumentToken ? 'SPOT' :
        packet.instrumentToken === this.futureEntry.instrumentToken ? 'FUTURE' : null;
      if (!role) continue;
      const exchange = time(packet.exchangeTimestamp);
      const previous = role === 'SPOT' ? this.spot : this.future;
      if (previous && Number.isFinite(exchange) && exchange <= previous.exchange) continue;
      const value = role === 'SPOT' ? packet.lastPrice : packet.averageTradePrice;
      const valid = packet.mode === 'full' && packet.isIndex === (role === 'SPOT') && positive(value) &&
        Number.isFinite(exchange) && exchange <= received && now - exchange <= 5000 && istDate(exchange) === this.masterDate;
      // A new invalid reference revokes its old value. Never substitute futures LTP.
      const observation = valid ? { value: value as number, exchange, received } : null;
      if (role === 'SPOT') this.spot = observation; else this.future = observation;
    }
  }

  read() {
    const now = this.now();
    if (!this.connected() || istDate(now) !== this.masterDate) { this.clear(); return null; }
    if (!this.spot || !this.future || [this.spot, this.future].some(o =>
      now < o.exchange || now < o.received || now - o.exchange > 5000 || now - o.received > 5000)) return null;
    return { symbol: 'BANKNIFTY' as const, spot_ltp: this.spot.value, vwap: this.future.value,
      spot_ts: new Date(this.spot.exchange).toISOString(), vwap_ts: new Date(this.future.exchange).toISOString(),
      vwap_basis: BASIS, comparison_policy: POLICY, reference_identity: this.identity() };
  }

  identity() { return { spotToken: this.spotEntry.instrumentToken, nearFutureToken: this.futureEntry.instrumentToken,
    nearFutureLabel: this.futureEntry.instrumentLabel, nearFutureExpiry: this.futureEntry.expiry,
    masterDate: this.masterDate, vwapBasis: BASIS, comparisonPolicy: POLICY }; }
}

type Observer = (ticks: KiteDecodedPacket[], receivedAt: string) => void;
/** Explicit host binding; pass the existing trading-feed registerKiteTickObserver. */
export function installBnfShadowTradingFeed(config: {
  enabled: boolean; writer: Writable; entries: KiteImmediateTokenEntry[]; masterDate: string;
  connected: () => boolean; now?: () => number;
  expiryClockFor?: (token: number, observedAt: string) => { expiry_clock_source: 'INDEX_EXPIRY_CLOCK'; expiry_ts: string } | null;
  registerObserver: (observer: Observer) => () => void;
  contractFor: (token: number) => { instrument_token: number; tradingsymbol: string } | null;
}) {
  const cache = config.enabled ? new BnfMarketReferenceCache(config.entries, config.masterDate, config.connected, config.now) : null;
  let referenceFault: string | null = null;
  const relay = installBnfShadowFeedRelay({ ...config,
    contextFor: () => cache?.read() ?? null,
    registerObserver: observer => config.registerObserver((ticks, receivedAt) => {
      if (referenceFault) return;
      try { cache!.ingest(ticks, receivedAt); }
      catch { referenceFault = 'REFERENCE_CALLBACK_FAILED'; cache!.clear(); return; }
      observer(ticks, receivedAt);
    }),
  });
  return { status: () => ({ ...relay.status(), referenceFault }), identity: () => cache?.identity() ?? null,
    stop: () => { relay.stop(); cache?.clear(); } };
}

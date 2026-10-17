import { createHash, randomUUID } from 'node:crypto';
import { resolveKiteAuthoritySession } from './kite-session-authority.js';
import { fetchH1KiteLiveInstrumentMaster } from './h1-kite-live-instrument-master-adapter.js';
import { validateSellerBasketMarginProof } from './seller-kite-margin-proof-shadow.js';

export interface SellerMarginRequest {
  snapshotId: string;
  symbol: 'NIFTY' | 'SENSEX';
  shortToken: number;
  longToken: number;
  quantity: number;
  product: 'NRML' | 'MIS';
}
interface Dependencies {
  fetchImpl: typeof fetch;
  now: () => number;
  authority: typeof resolveKiteAuthoritySession;
  apiKey: () => string;
}
const SAFE = { researchOnly: true, createsOrders: false, affectsExecution: false,
  affectsTelegram: false, executionReady: false } as const;
const MAX_AGE_MS = 10_000;
const ORIGIN = 'https://api.kite.trade';
const text = (x: unknown): x is string => typeof x === 'string' && x.trim().length > 0;
const record = (x: unknown): x is Record<string, any> => typeof x === 'object' && x !== null && !Array.isArray(x);
const positive = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && x > 0;
const digest = (x: unknown) => createHash('sha256').update(JSON.stringify(x)).digest('hex');
const blocked = (code: string) => ({ status: 'BLOCKED' as const, blockers: [code],
  brokerProvenanceVerified: false as const, ...SAFE });

/** No runtime registration. Dependency overrides always label results TEST_ONLY. */
export function createSellerKiteBasketMarginReader(overrides: Partial<Dependencies> = {}) {
  const testOnly = Object.keys(overrides).length > 0;
  const deps: Dependencies = { fetchImpl: fetch, now: Date.now,
    authority: resolveKiteAuthoritySession, apiKey: () => process.env.KITE_API_KEY?.trim() || '', ...overrides };
  return async function readSellerBasketMargin(value: SellerMarginRequest) {
    // Copy before the first await: a caller cannot mutate the submitted basket in flight.
    if (!record(value)) return blocked('MARGIN_REQUEST_INVALID');
    const request = { ...value };
    if (!text(request.snapshotId) || !['NIFTY','SENSEX'].includes(request.symbol) ||
        !['NRML','MIS'].includes(request.product) ||
        ![request.shortToken,request.longToken,request.quantity].every(x => Number.isSafeInteger(x) && x > 0) ||
        request.shortToken === request.longToken) return blocked('MARGIN_REQUEST_INVALID');
    try {
      const startedAtMs = deps.now();
      if (!Number.isSafeInteger(startedAtMs) || startedAtMs <= 0) return blocked('MARGIN_CLOCK_INVALID');
      const apiKey = deps.apiKey();
      const auth = await deps.authority(startedAtMs);
      const session = auth.session;
      if (!text(apiKey) || !auth.status.active || !session || !text(session.accessToken) ||
          !text(session.userId) || !text(session.sessionIdFingerprint) ||
          !Number.isFinite(session.expiresAt) || session.expiresAt <= startedAtMs) return blocked('KITE_SESSION_UNAVAILABLE');
      const headers = { 'X-Kite-Version':'3', Authorization:`token ${apiKey}:${session.accessToken}` };
      // Fixed paths only; credentials must never follow a redirect to another host.
      const fetchBound: typeof fetch = (url, init) => {
        const allowed = [`${ORIGIN}/instruments`,`${ORIGIN}/user/profile`,`${ORIGIN}/margins/basket?consider_positions=true`];
        if (typeof url !== 'string' || !allowed.includes(url)) throw new Error('ENDPOINT_BLOCKED');
        return deps.fetchImpl(url, { ...init, redirect:'error', signal:AbortSignal.timeout(8000) });
      };
      const profileResponse = await fetchBound(`${ORIGIN}/user/profile`, { headers });
      if (!profileResponse.ok) return blocked('KITE_PROFILE_HTTP_FAILED');
      const profile: unknown = await profileResponse.json();
      if (!record(profile) || profile.status !== 'success' || !record(profile.data) ||
          profile.data.user_id !== session.userId) return blocked('KITE_ACCOUNT_MISMATCH');
      const master = await fetchH1KiteLiveInstrumentMaster({ apiKey, accessToken:session.accessToken, fetchImpl:fetchBound });
      if (!master.ready) return blocked('KITE_INSTRUMENT_MASTER_UNAVAILABLE');
      const shortRows = master.rows.filter(x => x.instrument_token === request.shortToken);
      const longRows = master.rows.filter(x => x.instrument_token === request.longToken);
      if (shortRows.length !== 1 || longRows.length !== 1) return blocked('MARGIN_TOKEN_NOT_UNIQUE');
      const short = shortRows[0], long = longRows[0];
      const exchange = request.symbol === 'NIFTY' ? 'NFO' : 'BFO';
      if ([short,long].some(x => x.name !== request.symbol || x.exchange !== exchange ||
          x.segment !== `${exchange}-OPT` || !text(x.tradingsymbol) || !positive(x.strike) ||
          !Number.isSafeInteger(x.lot_size) || Number(x.lot_size) <= 0 ||
          request.quantity % Number(x.lot_size) !== 0) || short.lot_size !== long.lot_size ||
          short.expiry !== long.expiry || short.instrument_type !== long.instrument_type ||
          !['CE','PE'].includes(short.instrument_type || '') ||
          short.tradingsymbol === long.tradingsymbol ||
          (short.instrument_type === 'CE' ? Number(long.strike) <= Number(short.strike) : Number(long.strike) >= Number(short.strike))) {
        return blocked('MARGIN_MASTER_PAIR_MISMATCH');
      }
      const expiry = short.expiry;
      const todayIST = new Date(startedAtMs + 19_800_000).toISOString().slice(0,10);
      const expiryMs = typeof expiry === 'string' ? Date.parse(expiry + 'T00:00:00Z') : NaN;
      if (!text(expiry) || !/^\d{4}-\d{2}-\d{2}$/.test(expiry) || !Number.isFinite(expiryMs) ||
          new Date(expiryMs).toISOString().slice(0,10) !== expiry || expiry < todayIST) return blocked('MARGIN_EXPIRY_INVALID');
      // Hedge first for the calculation; these descriptors are never sent to an order endpoint.
      const basket = ([ [long,'BUY'], [short,'SELL'] ] as const).map(([row, side]) => ({
        exchange, tradingsymbol:row.tradingsymbol, transaction_type:side,
        variety:'regular', product:request.product, order_type:'MARKET', quantity:request.quantity,
        price:0, trigger_price:0,
      }));
      const requestedAtMs = deps.now();
      if (!Number.isSafeInteger(requestedAtMs) || requestedAtMs < startedAtMs || requestedAtMs - startedAtMs > MAX_AGE_MS) return blocked('MARGIN_CONTEXT_STALE');
      const localRequestId = randomUUID();
      const response = await fetchBound(`${ORIGIN}/margins/basket?consider_positions=true`, {
        method:'POST', headers:{...headers,'Content-Type':'application/json'}, body:JSON.stringify(basket),
      });
      if (!response.ok) return blocked('KITE_BASKET_MARGIN_HTTP_FAILED');
      const body: unknown = await response.json();
      if (!record(body) || body.status !== 'success' || !record(body.data)) return blocked('KITE_BASKET_MARGIN_BODY_INVALID');
      const data = body.data;
      if (!record(data.initial) || !record(data.final) || !positive(data.initial.total) || !positive(data.final.total)) return blocked('MARGIN_TOTAL_INVALID');
      // Kite echoes symbol/exchange, not side/product/quantity/account. Those are bound to our own HTTPS request.
      if (!Array.isArray(data.orders) || data.orders.length !== 2 || basket.some(order =>
          data.orders.filter((x: unknown) => record(x) && x.exchange === order.exchange && x.tradingsymbol === order.tradingsymbol).length !== 1)) {
        return blocked('MARGIN_RESPONSE_LEGS_MISMATCH');
      }
      const receivedAtMs = deps.now();
      const current = await deps.authority(receivedAtMs);
      const checkedAtMs = deps.now();
      if (!current.status.active || !current.session ||
          current.session.sessionIdFingerprint !== session.sessionIdFingerprint ||
          current.session.userId !== session.userId || current.session.accessToken !== session.accessToken ||
          !Number.isSafeInteger(receivedAtMs) || !Number.isSafeInteger(checkedAtMs) ||
          receivedAtMs < requestedAtMs || checkedAtMs < receivedAtMs ||
          checkedAtMs - startedAtMs > MAX_AGE_MS || session.expiresAt <= checkedAtMs ||
          current.session.expiresAt <= checkedAtMs) return blocked('MARGIN_SESSION_OR_TIME_CHANGED');
      const leg = (row: typeof short, transactionType:'BUY'|'SELL') => ({
        instrumentToken:row.instrument_token, exchange, tradingSymbol:row.tradingsymbol,
        expiry, strike:Number(row.strike), optionType:row.instrument_type as 'CE'|'PE',
        transactionType, quantity:request.quantity,
      });
      const structure = validateSellerBasketMarginProof({ source:'KITE_BASKET_MARGIN_RESPONSE',
        // Local correlation IDs: Kite does not document a unique response ID.
        requestId:localRequestId, responseId:`local-receipt:${localRequestId}`, snapshotId:request.snapshotId,
        requestedAtMs, receivedAtMs, asOfMs:checkedAtMs, maxAgeMs:MAX_AGE_MS,
        shortLeg:leg(short,'SELL'), longLeg:leg(long,'BUY'), marginRequired:data.initial.total,
      });
      if (!structure.verified) return blocked('MARGIN_STRUCTURE_INVALID');
      return { status:'PARTIAL' as const, source:testOnly ? 'TEST_ONLY' as const : 'KITE_HTTPS' as const,
        brokerProvenanceVerified:!testOnly, localRequestId, snapshotId:request.snapshotId,
        accountBinding:digest([session.userId,session.sessionIdFingerprint]),
        requestBinding:digest([session.userId,session.sessionIdFingerprint,request.snapshotId,basket]),
        responseBinding:digest(data),
        basket, shortLeg:leg(short,'SELL'), longLeg:leg(long,'BUY'),
        initialMargin:data.initial.total as number, finalMargin:data.final.total as number,
        conservativeMargin:Math.max(data.initial.total,data.final.total),
        considerPositions:true, requestedAtMs, receivedAtMs, checkedAtMs,
        maxAgeMs:MAX_AGE_MS, responseLegsMatched:true, ...SAFE };
    } catch {
      // Never return broker error bodies, headers, tokens, or exception messages.
      return blocked('KITE_MARGIN_READ_FAILED');
    }
  };
}

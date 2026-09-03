import type { H1ExactDepthObservation, H1ExactContractIdentity } from "./h1-live-exact-snapshot-aggregator.js";
import type { KiteDecodedPacket } from "./kite-websocket-binary-decoder.js";

export interface H1KiteDepthObservationAdapterInput {
  packet: KiteDecodedPacket;
  expectedInstrumentToken: number;
  identity: H1ExactContractIdentity;
  lotQuantity: number;
  receivedAt: string;
}

export interface H1KiteDepthObservationAdapterResult {
  version: "H1_KITE_DEPTH_OBSERVATION_ADAPTER_V1";
  ready: boolean;
  observation: H1ExactDepthObservation | null;
  blockers: string[];
  failClosed: true;
  semantics: "KITE_FULL_TOP_OF_BOOK_LIVE_RUNTIME_EXACT_ONLY";
}

function validDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const n = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(n) && new Date(n).toISOString().slice(0, 10) === value;
}

function validIdentity(identity: H1ExactContractIdentity): boolean {
  return (identity?.symbol === "NIFTY" || identity?.symbol === "SENSEX" || identity?.symbol === "BANKNIFTY") &&
    validDateOnly(identity.expiryDate) &&
    Number.isFinite(identity.strike) && identity.strike > 0 &&
    (identity.side === "CE" || identity.side === "PE") &&
    Number.isInteger(identity.dte) && identity.dte >= 0;
}

function validIso(value: string | null | undefined): boolean {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

export function adaptKiteFullPacketToH1DepthObservation(
  input: H1KiteDepthObservationAdapterInput,
): H1KiteDepthObservationAdapterResult {
  const blockers: string[] = [];
  const packet = input?.packet;

  if (!packet || packet.mode !== "full" || packet.isIndex) blockers.push("KITE_FULL_OPTION_PACKET_REQUIRED");
  if (!Number.isInteger(input?.expectedInstrumentToken) || input.expectedInstrumentToken <= 0) blockers.push("INVALID_EXPECTED_INSTRUMENT_TOKEN");
  if (packet && packet.instrumentToken !== input.expectedInstrumentToken) blockers.push("INSTRUMENT_TOKEN_MISMATCH");
  if (!validIdentity(input?.identity)) blockers.push("INVALID_CONTRACT_IDENTITY");
  if (!Number.isInteger(input?.lotQuantity) || input.lotQuantity <= 0) blockers.push("INVALID_LOT_QUANTITY");
  if (!validIso(input?.receivedAt)) blockers.push("INVALID_RECEIVED_AT");
  if (!packet?.exchangeTimestamp || !validIso(packet.exchangeTimestamp)) blockers.push("MISSING_EXACT_EXCHANGE_TIMESTAMP");
  if (!packet?.marketDepth || packet.marketDepth.buy.length < 1 || packet.marketDepth.sell.length < 1) blockers.push("MISSING_MARKET_DEPTH");

  const bestBid = packet?.marketDepth?.buy?.[0];
  const bestAsk = packet?.marketDepth?.sell?.[0];
  if (bestBid && (!Number.isFinite(bestBid.price) || bestBid.price <= 0 || !Number.isInteger(bestBid.quantity) || bestBid.quantity < 0)) blockers.push("INVALID_BEST_BID");
  if (bestAsk && (!Number.isFinite(bestAsk.price) || bestAsk.price <= 0 || !Number.isInteger(bestAsk.quantity) || bestAsk.quantity < 0)) blockers.push("INVALID_BEST_ASK");
  if (bestBid && bestAsk && Number.isFinite(bestBid.price) && Number.isFinite(bestAsk.price) && bestAsk.price <= bestBid.price) blockers.push("NON_POSITIVE_SPREAD");

  if (validIso(packet?.exchangeTimestamp) && validIso(input?.receivedAt) && Date.parse(input.receivedAt) < Date.parse(packet.exchangeTimestamp!)) {
    blockers.push("RECEIVED_BEFORE_EXCHANGE_TIMESTAMP");
  }

  if (blockers.length > 0 || !packet.exchangeTimestamp || !bestBid || !bestAsk) {
    return {
      version: "H1_KITE_DEPTH_OBSERVATION_ADAPTER_V1",
      ready: false,
      observation: null,
      blockers,
      failClosed: true,
      semantics: "KITE_FULL_TOP_OF_BOOK_LIVE_RUNTIME_EXACT_ONLY",
    };
  }

  return {
    version: "H1_KITE_DEPTH_OBSERVATION_ADAPTER_V1",
    ready: true,
    observation: {
      ...input.identity,
      source: "LIVE_RUNTIME_EXACT",
      observedAt: packet.exchangeTimestamp,
      receivedAt: input.receivedAt,
      bid: bestBid.price,
      ask: bestAsk.price,
      bidQty: bestBid.quantity,
      askQty: bestAsk.quantity,
      lotQuantity: input.lotQuantity,
    },
    blockers: [],
    failClosed: true,
    semantics: "KITE_FULL_TOP_OF_BOOK_LIVE_RUNTIME_EXACT_ONLY",
  };
}

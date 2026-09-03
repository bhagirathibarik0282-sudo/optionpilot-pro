export type KiteMarketDepthEntry = {
  quantity: number;
  price: number;
  orders: number;
};

export type KiteDecodedPacket = {
  mode: "ltp" | "quote" | "full";
  instrumentToken: number;
  lastPrice: number;
  lastTradeQuantity?: number;
  averageTradePrice?: number;
  volume?: number;
  totalBuyQuantity?: number;
  totalSellQuantity?: number;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  lastTradeTimestamp?: string | null;
  oi?: number;
  oiDayHigh?: number;
  oiDayLow?: number;
  exchangeTimestamp?: string | null;
  marketDepth?: {
    buy: KiteMarketDepthEntry[];
    sell: KiteMarketDepthEntry[];
  };
  isIndex: boolean;
};

function u16(view: DataView, offset: number): number { return view.getUint16(offset, false); }
function i32(view: DataView, offset: number): number { return view.getInt32(offset, false); }
function isoFromUnixSeconds(value: number): string | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  const d = new Date(value * 1000);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function divisorForToken(token: number): number {
  const segment = token & 0xff;
  return segment === 3 ? 10_000_000 : 100;
}

function decodeMarketDepth(view: DataView, divisor: number): { buy: KiteMarketDepthEntry[]; sell: KiteMarketDepthEntry[] } {
  const entries: KiteMarketDepthEntry[] = [];
  for (let index = 0; index < 10; index++) {
    const offset = 64 + index * 12;
    entries.push({
      quantity: i32(view, offset),
      price: i32(view, offset + 4) / divisor,
      orders: u16(view, offset + 8),
    });
  }
  return { buy: entries.slice(0, 5), sell: entries.slice(5, 10) };
}

export function splitKiteBinaryFrame(data: ArrayBuffer | Uint8Array): Uint8Array[] {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes.byteLength === 1) return [];
  if (bytes.byteLength < 4) throw new Error("INVALID_KITE_BINARY_FRAME");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = u16(view, 0);
  let offset = 2;
  const packets: Uint8Array[] = [];
  for (let i = 0; i < count; i++) {
    if (offset + 2 > bytes.byteLength) throw new Error("TRUNCATED_KITE_PACKET_LENGTH");
    const length = u16(view, offset);
    offset += 2;
    if (length <= 0 || offset + length > bytes.byteLength) throw new Error("TRUNCATED_KITE_PACKET");
    packets.push(bytes.slice(offset, offset + length));
    offset += length;
  }
  return packets;
}

export function decodeKitePacket(packet: Uint8Array): KiteDecodedPacket {
  const length = packet.byteLength;
  if (![8, 28, 32, 44, 184].includes(length)) throw new Error(`UNSUPPORTED_KITE_PACKET_LENGTH_${length}`);
  const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);
  const instrumentToken = i32(view, 0);
  const divisor = divisorForToken(instrumentToken);
  const price = (offset: number) => i32(view, offset) / divisor;

  if (length === 8) {
    return { mode: "ltp", instrumentToken, lastPrice: price(4), isIndex: false };
  }

  if (length === 28 || length === 32) {
    return {
      mode: length === 28 ? "quote" : "full",
      instrumentToken,
      lastPrice: price(4),
      high: price(8),
      low: price(12),
      open: price(16),
      close: price(20),
      exchangeTimestamp: length === 32 ? isoFromUnixSeconds(i32(view, 28)) : null,
      isIndex: true,
    };
  }

  return {
    mode: length === 44 ? "quote" : "full",
    instrumentToken,
    lastPrice: price(4),
    lastTradeQuantity: i32(view, 8),
    averageTradePrice: price(12),
    volume: i32(view, 16),
    totalBuyQuantity: i32(view, 20),
    totalSellQuantity: i32(view, 24),
    open: price(28),
    high: price(32),
    low: price(36),
    close: price(40),
    lastTradeTimestamp: length === 184 ? isoFromUnixSeconds(i32(view, 44)) : null,
    oi: length === 184 ? i32(view, 48) : undefined,
    oiDayHigh: length === 184 ? i32(view, 52) : undefined,
    oiDayLow: length === 184 ? i32(view, 56) : undefined,
    exchangeTimestamp: length === 184 ? isoFromUnixSeconds(i32(view, 60)) : null,
    marketDepth: length === 184 ? decodeMarketDepth(view, divisor) : undefined,
    isIndex: false,
  };
}

export function decodeKiteBinaryFrame(data: ArrayBuffer | Uint8Array): KiteDecodedPacket[] {
  return splitKiteBinaryFrame(data).map(decodeKitePacket);
}

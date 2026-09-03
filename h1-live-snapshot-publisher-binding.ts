import type { H1ExactSnapshotBundle } from "./h1-live-exact-snapshot-aggregator.js";
import type { LivePremiumDeltaGammaPolicy } from "./h1-live-premium-delta-gamma-evaluator.js";
import type { MultiExpiryPeerSnapshot, ThetaIvMultiExpiryPolicy } from "./h1-live-theta-iv-multi-expiry-evaluator.js";
import type { LiveCapitalLiquidityDtePolicy } from "./h1-live-capital-liquidity-dte-gates.js";
import { produceH1LivePublisherPacket, type H1LivePublisherPacketProducerResult } from "./h1-live-publisher-packet-producer.js";

export interface H1LiveSnapshotPublisherBindingInput {
  previous: H1ExactSnapshotBundle;
  current: H1ExactSnapshotBundle;
  moneyness: "ATM" | "ITM1";
  multiExpiryPeers: MultiExpiryPeerSnapshot[];
  premiumPolicy: LivePremiumDeltaGammaPolicy;
  burdenPolicy: ThetaIvMultiExpiryPolicy;
  capitalLiquidityDtePolicy: LiveCapitalLiquidityDtePolicy;
  nowIso: string;
}

export interface H1LiveSnapshotPublisherBindingResult {
  version: "H1_LIVE_SNAPSHOT_PUBLISHER_BINDING_V1";
  ready: boolean;
  producer: H1LivePublisherPacketProducerResult | null;
  blockers: string[];
  failClosed: true;
  semantics: "READY_EXACT_BUNDLES_ONLY_NO_INFERENCE";
}

function sameIdentity(a: H1ExactSnapshotBundle, b: H1ExactSnapshotBundle): boolean {
  return !!a.identity && !!b.identity && a.identity.symbol === b.identity.symbol &&
    a.identity.expiryDate === b.identity.expiryDate && a.identity.strike === b.identity.strike &&
    a.identity.side === b.identity.side && a.identity.dte === b.identity.dte;
}

export function bindH1LiveExactSnapshotsToPublisher(input: H1LiveSnapshotPublisherBindingInput): H1LiveSnapshotPublisherBindingResult {
  const blockers: string[] = [];
  if (!input?.previous?.ready || !input.previous.identity || !input.previous.priceGreek || !input.previous.depth) blockers.push("PREVIOUS_EXACT_BUNDLE_NOT_READY");
  if (!input?.current?.ready || !input.current.identity || !input.current.priceGreek || !input.current.depth) blockers.push("CURRENT_EXACT_BUNDLE_NOT_READY");
  if (blockers.length === 0 && !sameIdentity(input.previous, input.current)) blockers.push("PREVIOUS_CURRENT_CONTRACT_MISMATCH");
  if (input?.moneyness !== "ATM" && input?.moneyness !== "ITM1") blockers.push("INVALID_MONEYNESS");

  if (blockers.length === 0) {
    const prevMs = Date.parse(input.previous.observedAt!);
    const currMs = Date.parse(input.current.observedAt!);
    if (!Number.isFinite(prevMs) || !Number.isFinite(currMs) || currMs <= prevMs) blockers.push("NON_FORWARD_EXACT_BUNDLE_CHRONOLOGY");
  }

  if (blockers.length > 0) return { version: "H1_LIVE_SNAPSHOT_PUBLISHER_BINDING_V1", ready: false, producer: null, blockers, failClosed: true, semantics: "READY_EXACT_BUNDLES_ONLY_NO_INFERENCE" };

  const current = input.current;
  const previous = input.previous;
  const id = current.identity!;
  const pg = current.priceGreek!;
  const prevPg = previous.priceGreek!;
  const depth = current.depth!;

  const producer = produceH1LivePublisherPacket({
    identity: {
      symbol: id.symbol, side: id.side, strike: id.strike, expiryDate: id.expiryDate, dte: id.dte,
      moneyness: input.moneyness, premiumLtp: pg.ltp, observedAt: current.observedAt!,
      source: "H1_LIVE_EXACT_SNAPSHOT_AGGREGATOR_V1", provenance: "LIVE_RUNTIME_EXACT",
    },
    previousPremiumSnapshot: { symbol: id.symbol, expiry: id.expiryDate, strike: id.strike, side: id.side, observedAt: previous.observedAt!, ltp: prevPg.ltp, delta: prevPg.delta, gamma: prevPg.gamma, source: "LIVE_RUNTIME_EXACT" },
    currentPremiumSnapshot: { symbol: id.symbol, expiry: id.expiryDate, strike: id.strike, side: id.side, observedAt: current.observedAt!, ltp: pg.ltp, delta: pg.delta, gamma: pg.gamma, source: "LIVE_RUNTIME_EXACT" },
    premiumPolicy: input.premiumPolicy,
    burdenSnapshot: { source: "LIVE_RUNTIME_EXACT", symbol: id.symbol, side: id.side, strike: id.strike, expiryDate: id.expiryDate, dte: id.dte, observedAt: current.observedAt!, premiumLtp: pg.ltp, theta: pg.theta, iv: pg.iv },
    multiExpiryPeers: input.multiExpiryPeers,
    burdenPolicy: input.burdenPolicy,
    capitalLiquidityDteEvidence: { provenance: "LIVE_RUNTIME_EXACT", symbol: id.symbol, dte: id.dte, premiumLtp: pg.ltp, lotQuantity: depth.lotQuantity, bid: depth.bid, ask: depth.ask, bidQty: depth.bidQty, askQty: depth.askQty, occurredAt: depth.observedAt, receivedAt: depth.receivedAt },
    capitalLiquidityDtePolicy: input.capitalLiquidityDtePolicy,
    nowIso: input.nowIso,
  });

  if (!producer.ready || !producer.packet) return { version: "H1_LIVE_SNAPSHOT_PUBLISHER_BINDING_V1", ready: false, producer, blockers: producer.blockers.map((x) => `PRODUCER_${x}`), failClosed: true, semantics: "READY_EXACT_BUNDLES_ONLY_NO_INFERENCE" };
  return { version: "H1_LIVE_SNAPSHOT_PUBLISHER_BINDING_V1", ready: true, producer, blockers: [], failClosed: true, semantics: "READY_EXACT_BUNDLES_ONLY_NO_INFERENCE" };
}

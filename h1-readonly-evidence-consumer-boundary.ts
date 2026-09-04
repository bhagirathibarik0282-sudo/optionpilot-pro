import type { H1LiveExactRawEvidenceRow, H1LiveExactRawEvidenceStatus } from "./h1-live-exact-raw-evidence-store.js";
import type { H1NearestValidMonthlyPeerReadinessRow } from "./h1-nearest-valid-monthly-peer-readiness.js";

export interface H1ReadOnlyEvidenceConsumerRow {
  symbol: "NIFTY" | "SENSEX" | "BANKNIFTY";
  primaryExpiry: string;
  nearestPeerExpiry: string;
  ready: boolean;
  evidenceTokenCount: number;
  evidence: H1LiveExactRawEvidenceRow[];
  blockers: string[];
}

export interface H1ReadOnlyEvidenceConsumerResult {
  version: "H1_READONLY_EVIDENCE_CONSUMER_BOUNDARY_V1";
  rows: H1ReadOnlyEvidenceConsumerRow[];
  readySymbolCount: number;
  productionImpact: "NONE";
  readOnly: true;
  forwardsToGreeks: false;
  forwardsToDirection: false;
  forwardsToVerdict: false;
  forwardsToExecution: false;
  forwardsToTelegram: false;
  failClosed: true;
}

const supported = (value: string): value is H1ReadOnlyEvidenceConsumerRow["symbol"] =>
  value === "NIFTY" || value === "SENSEX" || value === "BANKNIFTY";

export function buildH1ReadOnlyEvidenceConsumerBoundary(
  evidence: H1LiveExactRawEvidenceStatus,
  nearest: H1NearestValidMonthlyPeerReadinessRow[],
): H1ReadOnlyEvidenceConsumerResult {
  const rows = nearest.filter((row) => supported(row.symbol)).map((peer): H1ReadOnlyEvidenceConsumerRow => {
    const blockers: string[] = [];
    if (!peer.ready) blockers.push(...peer.blockers, "NEAREST_PEER_NOT_READY");
    if (!peer.primaryExpiry) blockers.push("PRIMARY_EXPIRY_UNAVAILABLE");
    if (!peer.nearestPeerExpiry) blockers.push("NEAREST_PEER_EXPIRY_UNAVAILABLE");

    const symbolRows = evidence.rows.filter((row) => row.symbol === peer.symbol);
    const selected = symbolRows.filter((row) =>
      row.role === "SPOT" ||
      (row.role === "OPTION" && (row.expiry === peer.primaryExpiry || row.expiry === peer.nearestPeerExpiry))
    );
    const spotCount = selected.filter((row) => row.role === "SPOT").length;
    const primaryOptions = selected.filter((row) => row.role === "OPTION" && row.expiry === peer.primaryExpiry).length;
    const peerOptions = selected.filter((row) => row.role === "OPTION" && row.expiry === peer.nearestPeerExpiry).length;
    if (spotCount !== 1) blockers.push(`EXACT_SPOT_COUNT_INVALID:${spotCount}/1`);
    if (primaryOptions !== 2) blockers.push(`PRIMARY_OPTION_PAIR_INVALID:${primaryOptions}/2`);
    if (peerOptions !== 2) blockers.push(`NEAREST_PEER_OPTION_PAIR_INVALID:${peerOptions}/2`);

    const ready = blockers.length === 0 && selected.length === 5;
    return {
      symbol: peer.symbol,
      primaryExpiry: peer.primaryExpiry ?? "",
      nearestPeerExpiry: peer.nearestPeerExpiry ?? "",
      ready,
      evidenceTokenCount: selected.length,
      evidence: ready ? selected.map((row) => ({ ...row })) : [],
      blockers,
    };
  });

  return {
    version: "H1_READONLY_EVIDENCE_CONSUMER_BOUNDARY_V1",
    rows,
    readySymbolCount: rows.filter((row) => row.ready).length,
    productionImpact: "NONE",
    readOnly: true,
    forwardsToGreeks: false,
    forwardsToDirection: false,
    forwardsToVerdict: false,
    forwardsToExecution: false,
    forwardsToTelegram: false,
    failClosed: true,
  };
}

import type { LiveGateEvidencePacket, LiveGateName } from "./h1-live-gate-evidence-assembler.js";
import type { CanonicalLiveFamilySignalEnvelope } from "./canonical-live-family-signal-registry.js";
import type { CanonicalDeterministicFamilySignal } from "./canonical-normalized-family-support-producer.js";

export const H1_EXACT_CORE_FAMILY_SIGNAL_ADAPTER_V1 = "H1_EXACT_CORE_FAMILY_SIGNAL_ADAPTER_V1" as const;

export type H1ExactCoreFamily = "OPTION_PREMIUMS" | "MULTI_DTE" | "LIQUIDITY_EXECUTABILITY";

export interface H1ExactCoreFamilySignalInput extends CanonicalDeterministicFamilySignal {
  family: H1ExactCoreFamily;
}

export interface H1ExactCoreFamilySignalAdapterResult {
  version: typeof H1_EXACT_CORE_FAMILY_SIGNAL_ADAPTER_V1;
  ready: boolean;
  envelopes: CanonicalLiveFamilySignalEnvelope[];
  blockers: string[];
  suppliedStrengthsPreserved: true;
  inferredStrengthsUsed: false;
  candidateSelected: false;
  sendsTelegram: false;
  createsOrders: false;
  affectsExecution: false;
  failClosed: true;
}

const REQUIRED_FAMILIES: H1ExactCoreFamily[] = [
  "OPTION_PREMIUMS",
  "MULTI_DTE",
  "LIQUIDITY_EXECUTABILITY",
];

const FAMILY_GATES: Record<H1ExactCoreFamily, LiveGateName[]> = {
  OPTION_PREMIUMS: [
    "premiumResponseConfirmed",
    "deltaGammaResponseConfirmed",
    "thetaIvBurdenAcceptable",
  ],
  MULTI_DTE: ["multiExpiryConflictAbsent"],
  LIQUIDITY_EXECUTABILITY: ["capitalFit", "liquidityOk", "spreadOk"],
};

function validTime(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function validSignal(signal: H1ExactCoreFamilySignalInput, manifest: string): boolean {
  return Boolean(
    signal
    && REQUIRED_FAMILIES.includes(signal.family)
    && signal.stance === "BUYER_SUPPORT"
    && Number.isFinite(signal.strength)
    && signal.strength >= 0
    && signal.strength <= 100
    && signal.deterministic === true
    && signal.evidenceReady === true
    && typeof signal.sourceId === "string"
    && signal.sourceId.trim()
    && signal.sourceManifestHash === manifest
    && signal.sourceSemantics === "EXPLICIT_DIRECTIONAL_SUPPORT"
    && signal.grantsDirectionalSupport === true
    && Array.isArray(signal.devilFlags)
    && signal.devilFlags.length === 0
  );
}

function identityValid(packet: LiveGateEvidencePacket): boolean {
  const identity = packet?.identity;
  return Boolean(
    identity
    && ["NIFTY", "SENSEX", "BANKNIFTY"].includes(identity.symbol)
    && (identity.side === "CE" || identity.side === "PE")
    && Number.isFinite(identity.strike) && identity.strike > 0
    && Number.isInteger(identity.dte) && identity.dte >= 0
    && Number.isFinite(identity.premiumLtp) && identity.premiumLtp > 0
    && identity.provenance === "LIVE_RUNTIME_EXACT"
    && typeof identity.source === "string" && identity.source.trim()
    && validTime(identity.observedAt) !== null
  );
}

/**
 * Attests three option-buyer business families against the exact H1 gate packet.
 * Strength is never derived from boolean gates: it must be supplied by an explicit,
 * deterministic upstream engine and is preserved byte-for-byte after verification.
 */
export function adaptH1ExactCoreFamilySignals(input: {
  packet: LiveGateEvidencePacket;
  familySignals: H1ExactCoreFamilySignalInput[];
  sourceManifestHash: string;
  nowMs: number;
  maxAgeMs?: number;
}): H1ExactCoreFamilySignalAdapterResult {
  const blockers: string[] = [];
  const maxAgeMs = input?.maxAgeMs ?? 90_000;
  const manifest = input?.sourceManifestHash;
  const packet = input?.packet;

  if (!identityValid(packet)) blockers.push("INVALID_EXACT_CONTRACT_IDENTITY");
  if (typeof manifest !== "string" || !manifest.trim()) blockers.push("INVALID_SOURCE_MANIFEST");
  if (!Number.isFinite(input?.nowMs) || input.nowMs <= 0 || !Number.isFinite(maxAgeMs) || maxAgeMs <= 0) {
    blockers.push("INVALID_TIME_POLICY");
  }

  const signals = Array.isArray(input?.familySignals) ? input.familySignals : [];
  const acceptedSignals: H1ExactCoreFamilySignalInput[] = [];
  const evidenceTimes: number[] = [];

  for (const family of REQUIRED_FAMILIES) {
    const matches = signals.filter((signal) => signal?.family === family);
    if (matches.length !== 1) {
      blockers.push(`${family}:${matches.length === 0 ? "SIGNAL_MISSING" : "SIGNAL_DUPLICATE"}`);
      continue;
    }
    const signal = matches[0];
    if (!validSignal(signal, manifest)) {
      blockers.push(`${family}:SIGNAL_INVALID_OR_UNATTESTED`);
      continue;
    }

    const requiredGates = [...FAMILY_GATES[family]];
    if (family === "MULTI_DTE" && packet?.identity) {
      if (packet.identity.symbol === "BANKNIFTY") requiredGates.push("higherDteUsable");
      else if (packet.identity.dte >= 5 && packet.identity.dte <= 7) requiredGates.push("fallbackDteApproved");
      else requiredGates.push("currentOrNearExpiryUsable");
    }

    let familyReady = true;
    for (const gateName of requiredGates) {
      const gate = packet?.gates?.[gateName];
      const observedMs = gate ? validTime(gate.observedAt) : null;
      const ageMs = observedMs == null ? Number.POSITIVE_INFINITY : input.nowMs - observedMs;
      if (
        !gate
        || gate.provenance !== "LIVE_RUNTIME_EXACT"
        || gate.value !== true
        || typeof gate.source !== "string"
        || !gate.source.trim()
        || ageMs < 0
        || ageMs > maxAgeMs
      ) {
        blockers.push(`${family}:${gateName}:EXACT_GATE_NOT_ATTESTABLE`);
        familyReady = false;
      } else {
        evidenceTimes.push(observedMs as number);
      }
    }
    if (familyReady) acceptedSignals.push(signal);
  }

  if (signals.some((signal) => !REQUIRED_FAMILIES.includes(signal?.family))) {
    blockers.push("UNEXPECTED_CORE_FAMILY_SIGNAL");
  }

  const identityObservedMs = packet?.identity ? validTime(packet.identity.observedAt) : null;
  if (identityObservedMs != null) {
    const identityAge = input.nowMs - identityObservedMs;
    if (identityAge < 0 || identityAge > maxAgeMs) blockers.push("EXACT_CONTRACT_IDENTITY_STALE_OR_FUTURE");
    else evidenceTimes.push(identityObservedMs);
  }

  const uniqueBlockers = [...new Set(blockers)];
  if (uniqueBlockers.length > 0 || acceptedSignals.length !== REQUIRED_FAMILIES.length) {
    return {
      version: H1_EXACT_CORE_FAMILY_SIGNAL_ADAPTER_V1,
      ready: false,
      envelopes: [],
      blockers: uniqueBlockers,
      suppliedStrengthsPreserved: true,
      inferredStrengthsUsed: false,
      candidateSelected: false,
      sendsTelegram: false,
      createsOrders: false,
      affectsExecution: false,
      failClosed: true,
    };
  }

  const observedAtMs = Math.min(...evidenceTimes);
  return {
    version: H1_EXACT_CORE_FAMILY_SIGNAL_ADAPTER_V1,
    ready: true,
    envelopes: acceptedSignals.map((signal) => ({
      provenance: "LIVE_DETERMINISTIC_FAMILY_SIGNAL_V1",
      symbol: packet.identity.symbol,
      observedAtMs,
      signal: { ...signal, devilFlags: [] },
    })),
    blockers: [],
    suppliedStrengthsPreserved: true,
    inferredStrengthsUsed: false,
    candidateSelected: false,
    sendsTelegram: false,
    createsOrders: false,
    affectsExecution: false,
    failClosed: true,
  };
}

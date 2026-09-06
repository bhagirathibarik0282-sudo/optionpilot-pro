import assert from "node:assert/strict";
import test from "node:test";
import { buildCanonicalLiveShadowSnapshotSource } from "../canonical-live-shadow-snapshot-source.js";
import type { CanonicalMarketComponent, CanonicalMarketFamily } from "../canonical-one-roof-market-snapshot.js";

const now = 1_800_000_000_000;
const hash = "a".repeat(64);
const baseFamilies: CanonicalMarketFamily[] = [
  "MARKET_STRUCTURE","FUTURES_CONFIRMATION","OPTION_PREMIUMS","OI_POSITIONING","MULTI_DTE","VOLATILITY","RESPONSE_LADDER","LIQUIDITY_EXECUTABILITY",
];
const baseComponents: CanonicalMarketComponent[] = baseFamilies.map((family, i) => ({
  family, status: "VERIFIED", exchangeTimestampMs: now - 500, receivedAtMs: now - 400,
  processedAtMs: now - 300, ingestSeq: i + 1, provenance: "LOCAL_DERIVED", source: `TEST_${family}`,
  payload: { ok: true }, devilFlags: [],
}));
const budgets = Object.fromEntries([
  ...baseFamilies.map((family) => [family, 5_000]), ["HEAVYWEIGHTS", 5_000], ["SECTOR_BREADTH", 5_000],
]) as any;
const registry = [
  { instrumentToken: 101, parentSymbol: "NIFTY" as const, role: "HEAVYWEIGHT" as const, tradingsymbol: "HDFCBANK", sector: "BANK", weight: 12, source: "KITE_INSTRUMENT_MASTER" as const },
  { instrumentToken: 102, parentSymbol: "NIFTY" as const, role: "SECTOR_CONSTITUENT" as const, tradingsymbol: "RELIANCE", sector: "ENERGY", weight: 10, source: "KITE_INSTRUMENT_MASTER" as const },
];
const tick = (instrumentToken: number, age = 500) => ({ instrumentToken, exchangeTimestampMs: now - age, receivedAtMs: now - age + 50, processedAtMs: now - age + 100, ingestSeq: instrumentToken, ltp: 100 });

function service(ticks: any[]) {
  return {
    status: () => ({
      started: true, connected: true, productionImpact: "NONE", readOnly: true, forwardsDownstream: false,
      affectsDirection: false, affectsVerdict: false, affectsExecution: false, affectsTelegram: false, failClosed: true,
    }),
    constituentTicks: (symbol?: string) => symbol === "NIFTY" ? ticks : [],
  };
}

function input(ticks: any[]) {
  return {
    activation: {
      version: "CANONICAL_READONLY_SHADOW_ACTIVATION_BOUNDARY_V1", ready: true, activated: true, sourceManifestHash: hash,
      blockers: [], explicitOptInRequired: true, defaultEnabled: false, readOnly: true, shadowOnly: true, productionImpact: "NONE",
      forwardsDownstream: false, affectsDirection: false, affectsVerdict: false, affectsExecution: false, affectsTelegram: false,
      grantsCandidateAuthority: false, wiredIntoServer: false, failClosed: true,
    } as any,
    composition: {
      version: "CANONICAL_READONLY_SHADOW_COMPOSITION_V1", ready: true, sourceManifestHash: hash,
      constituentMembershipCount: 2, uniqueConstituentTokenCount: 2, service: service(ticks), blockers: [], readOnly: true,
      shadowOnly: true, constructsService: true, startsSocket: false, credentialsExposed: false, activatesProduction: false,
      forwardsDownstream: false, affectsDirection: false, affectsVerdict: false, affectsExecution: false, affectsTelegram: false,
      grantsCandidateAuthority: false, failClosed: true,
    } as any,
    selectionConfig: {
      version: "CANONICAL_SELECTION_WEBSOCKET_CONFIG_ADAPTER_V1", ready: true, sourceManifestHash: hash,
      constituentRegistry: registry, uniqueInstrumentTokenCount: 2, membershipCount: 2, blockers: [], readOnly: true,
      configOnly: true, startsSocket: false, activatesRuntime: false, affectsDirection: false, affectsVerdict: false,
      affectsExecution: false, affectsTelegram: false, grantsCandidateAuthority: false, failClosed: true,
    } as any,
    snapshotId: "snap-live-1", symbol: "NIFTY" as const, asOfMs: now, minuteClosed: true,
    connectionId: "conn-1", instrumentMasterVersion: "master-v1", baseComponents,
    constituentFreshnessMs: 2_000, freshnessBudgetsMs: budgets,
    ingestTelemetry: { queueDepth: 0, queueLagMs: 0, droppedPacketCount: 0, backpressureActive: false },
  };
}

test("builds strict-ready canonical snapshot from activated read-only service ticks", () => {
  const out = buildCanonicalLiveShadowSnapshotSource(input([tick(101), tick(102)]));
  assert.equal(out.ready, true);
  assert.equal(out.snapshotReadyForStrictFiltering, true);
  assert.equal(out.constituentTickCount, 2);
  assert.equal(out.snapshot?.newEntryGate, "ALLOW_NEW_ENTRIES");
  assert.equal(out.forwardsDownstream, false);
  assert.equal(out.affectsExecution, false);
  assert.equal(out.affectsTelegram, false);
  assert.equal(out.wiredIntoServer, false);
});

test("preserves canonical BLOCK_NEW_ENTRIES when live constituent evidence is incomplete", () => {
  const out = buildCanonicalLiveShadowSnapshotSource(input([tick(101)]));
  assert.equal(out.ready, true);
  assert.equal(out.snapshotReadyForStrictFiltering, false);
  assert.equal(out.snapshot?.newEntryGate, "BLOCK_NEW_ENTRIES");
  assert.equal(out.snapshot?.components.find((x) => x.family === "SECTOR_BREADTH")?.status, "BLOCKED");
});

test("fails closed when activation, manifest chain, registry counts, or service authority are invalid", () => {
  const disabled = input([tick(101), tick(102)]); disabled.activation.activated = false;
  assert.equal(buildCanonicalLiveShadowSnapshotSource(disabled).ready, false);

  const mismatch = input([tick(101), tick(102)]); mismatch.selectionConfig.sourceManifestHash = "b".repeat(64);
  assert.match(buildCanonicalLiveShadowSnapshotSource(mismatch).blockers.join("|"), /MANIFEST_HASH_MISMATCH/);

  const counts = input([tick(101), tick(102)]); counts.composition.constituentMembershipCount = 3;
  assert.match(buildCanonicalLiveShadowSnapshotSource(counts).blockers.join("|"), /REGISTRY_COUNT_MISMATCH/);

  const unsafe = input([tick(101), tick(102)]); unsafe.composition.service.status = () => ({
    started: true, connected: true, productionImpact: "NONE", readOnly: true, forwardsDownstream: false,
    affectsDirection: false, affectsVerdict: false, affectsExecution: true, affectsTelegram: false, failClosed: true,
  });
  assert.match(buildCanonicalLiveShadowSnapshotSource(unsafe).blockers.join("|"), /SERVICE_STATE_INVALID/);
});

import assert from "node:assert/strict";
import test from "node:test";
import type { H1GoldChaseExactLineagePublisherInput } from "../h1-gold-chase-exact-lineage-publisher-v1.js";
import type { LiveGateEvidencePacket } from "../h1-live-gate-evidence-assembler.js";
import { H1GoldChaseReadOnlyLineageAdapter } from "../h1-gold-chase-readonly-lineage-adapter-v1.js";

const packet = { identity: { observedAt: "2026-09-17T09:30:00.000Z" } } as LiveGateEvidencePacket;
const dualPath = { version: "KITE_H1_EXACT_DUAL_PATH_CORE_V1" } as any;

test("approved producer publishes only the original same-ingest packet", async () => {
  const published = { ready: true, state: "PUBLISHED", blockers: [] } as any;
  const resolver = { resolver: () => (() => null), publish: () => published } as any;
  const adapter = new H1GoldChaseReadOnlyLineageAdapter(
    () => ({ packet } as H1GoldChaseExactLineagePublisherInput),
    resolver,
    { publish: () => published },
  );
  const out = await adapter.publish({ packet, dualPath, observedAt: packet.identity.observedAt });
  assert.equal(out.state, "PUBLISHED");
  assert.equal(out.ready, true);
  assert.equal(out.affectsTelegram, false);
  assert.equal(out.affectsExecution, false);
  assert.equal(out.createsOrders, false);
});

test("missing producer output fails closed", async () => {
  const adapter = new H1GoldChaseReadOnlyLineageAdapter(() => null);
  const out = await adapter.publish({ packet, dualPath, observedAt: packet.identity.observedAt });
  assert.equal(out.state, "BLOCKED");
  assert.deepEqual(out.blockers, ["APPROVED_LINEAGE_PRODUCER_NOT_READY"]);
});

test("copied packet is rejected before publication", async () => {
  const copied = { ...packet } as LiveGateEvidencePacket;
  const adapter = new H1GoldChaseReadOnlyLineageAdapter(
    () => ({ packet: copied } as H1GoldChaseExactLineagePublisherInput),
  );
  const out = await adapter.publish({ packet, dualPath, observedAt: packet.identity.observedAt });
  assert.equal(out.ready, false);
  assert.ok(out.blockers.includes("PRODUCER_PACKET_NOT_SAME_INGEST_OBJECT"));
});

test("producer exceptions are contained", async () => {
  const adapter = new H1GoldChaseReadOnlyLineageAdapter(() => { throw new Error("boom"); });
  const out = await adapter.publish({ packet, dualPath, observedAt: packet.identity.observedAt });
  assert.equal(out.ready, false);
  assert.deepEqual(out.blockers, ["APPROVED_LINEAGE_PRODUCER_EXCEPTION"]);
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  assertLockedCandidatePacket,
  buildLockedCandidateConsumerBundle,
  lockCandidatePacket,
  sameLockedIdentity,
} from "../locked-candidate-consumer-contract.ts";

function buyerPacket() {
  return lockCandidatePacket({
    decisionId: "decision-1",
    snapshotId: "snapshot-1",
    candidateKey: "NIFTY-20260908-24000-CE",
    symbol: "NIFTY",
    optionSide: "CE",
    businessRole: "OPTION_BUYER",
    expiry: "2026-09-08",
    strike: 24000,
    quantity: 2,
    referencePremium: 125.5,
    selectorVersion: "EXECUTION_CANDIDATE_SELECTOR_V2",
    lockedAtMs: Date.parse("2026-09-05T10:30:00.000Z"),
  });
}

test("all live-authority consumers receive the exact same locked identity", () => {
  const bundle = buildLockedCandidateConsumerBundle(buyerPacket());
  assert.ok(bundle.telegram);
  assert.equal(sameLockedIdentity(bundle.dashboard, bundle.telegram!), true);
  assert.equal(sameLockedIdentity(bundle.dashboard, bundle.kiteShadow), true);
  assert.equal(sameLockedIdentity(bundle.dashboard, bundle.journal), true);
  assert.strictEqual(bundle.dashboard, bundle.kiteShadow);
  assert.strictEqual(bundle.dashboard, bundle.journal);
  assert.strictEqual(bundle.dashboard, bundle.telegram);
  assert.equal(bundle.createsOrders, false);
  assert.equal(bundle.liveExecutionEnabled, false);
});

test("PE buy remains OPTION_BUYER and is Telegram transport eligible", () => {
  const packet = lockCandidatePacket({
    ...buyerPacket(),
    version: undefined as never,
    packetHash: undefined as never,
    decisionId: "decision-pe",
    candidateKey: "SENSEX-PE",
    symbol: "SENSEX",
    optionSide: "PE",
    businessRole: "OPTION_BUYER",
  } as never);
  const bundle = buildLockedCandidateConsumerBundle(packet);
  assert.equal(bundle.telegramEligible, true);
  assert.ok(bundle.telegram);
  assert.equal(bundle.telegram?.optionSide, "PE");
  assert.equal(bundle.telegram?.businessRole, "OPTION_BUYER");
});

test("seller analysis is never transported as a Telegram trade candidate", () => {
  const source = buyerPacket();
  const seller = lockCandidatePacket({
    decisionId: "decision-seller",
    snapshotId: source.snapshotId,
    candidateKey: "NIFTY-SELLER-ANALYSIS",
    symbol: "NIFTY",
    optionSide: "CE",
    businessRole: "OPTION_SELLER",
    expiry: source.expiry,
    strike: source.strike,
    quantity: source.quantity,
    referencePremium: source.referencePremium,
    selectorVersion: source.selectorVersion,
    lockedAtMs: source.lockedAtMs,
  });
  const bundle = buildLockedCandidateConsumerBundle(seller);
  assert.equal(bundle.telegramEligible, false);
  assert.equal(bundle.telegram, null);
  assert.equal(bundle.telegramReason, "SELLER_NOT_TRANSPORTABLE");
  assert.equal(sameLockedIdentity(bundle.dashboard, bundle.kiteShadow), true);
  assert.equal(sameLockedIdentity(bundle.dashboard, bundle.journal), true);
});

test("tampered consumer packet fails closed before any projection", () => {
  const packet = buyerPacket();
  const tampered = { ...packet, strike: packet.strike + 50 };
  assert.throws(() => assertLockedCandidatePacket(tampered), /LOCKED_PACKET_HASH_MISMATCH/);
  assert.throws(() => buildLockedCandidateConsumerBundle(tampered), /LOCKED_PACKET_HASH_MISMATCH/);
});

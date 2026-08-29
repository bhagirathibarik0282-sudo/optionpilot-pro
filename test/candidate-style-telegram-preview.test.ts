import test from "node:test";
import assert from "node:assert/strict";
import { buildCandidateStyleTelegramPreview, type CandidateStyleReadyCard } from "../candidate-style-telegram-preview.js";
import type { CandidateStyleSelectionResult } from "../candidate-style-selector.js";

const selectedContract = { symbol: "NIFTY", side: "CE" as const, strike: 25000, expiryDate: "2026-09-03", dte: 4 };

function result(overrides: Partial<CandidateStyleSelectionResult> = {}): CandidateStyleSelectionResult {
  return {
    version: "CANDIDATE_STYLE_SELECTOR_V1",
    semantics: "RESEARCH_SHADOW_ONLY",
    style: "SCALP",
    side: "CE",
    contract: selectedContract,
    status: "READY",
    candidateKey: "SCALP:NIFTY:CE:25000:2026-09-03:DTE4",
    reasons: ["SCALP_GATES_AND_CONFIRMATIONS_READY"],
    devilFlags: [],
    affectsVerdict: false,
    affectsTelegram: false,
    affectsExecution: false,
    ...overrides,
  };
}

const card: CandidateStyleReadyCard = {
  symbol: "NIFTY",
  decision: "BEST_CE",
  label: "BUY",
  strike: 25000,
  moneynessRole: "ATM",
  lastPrice: 210,
  spot: 25000,
  dte: 4,
  expiryDate: "2026-09-03",
  probability: 82,
  grade: "A",
  confidence: "HIGH",
  scoreReasons: ["premium confirmed"],
  contextNotes: [],
  riskFlags: [],
  blockStatus: { blocked: false },
  tmPlan: { status: "OK", entry: 210, sl: 190, t1: 230, t2: 250, t3: 270, rPremium: 20, atrUnderlying: 80, deltaUsed: 0.52, trailingRule: "trail after T1" },
  timestampIst: "09:45 IST",
};

test("READY preview may render exact already-computed trade card and style header", () => {
  const preview = buildCandidateStyleTelegramPreview(result(), card);
  assert.match(preview.text, /SCALP CE/);
  assert.match(preview.text, /Entry:/);
  assert.equal(preview.executablePlanShown, true);
  assert.equal(preview.affectsTelegram, false);
});

test("WATCH never renders entry stop or targets", () => {
  const preview = buildCandidateStyleTelegramPreview(result({ status: "WATCH", candidateKey: null }), card);
  assert.match(preview.text, /Watch only/);
  assert.doesNotMatch(preview.text, /Entry:/);
  assert.equal(preview.executablePlanShown, false);
});

test("BLOCKED never renders executable plan even if caller supplies a card", () => {
  const preview = buildCandidateStyleTelegramPreview(result({ status: "BLOCKED", candidateKey: null, devilFlags: ["LIQUIDITY_GATE_FAILED"] }), card);
  assert.match(preview.text, /No executable trade plan/);
  assert.doesNotMatch(preview.text, /Entry:/);
  assert.equal(preview.executablePlanShown, false);
});

test("DATA_UNAVAILABLE never renders executable numbers", () => {
  const preview = buildCandidateStyleTelegramPreview(result({ status: "DATA_UNAVAILABLE", side: null, contract: null, candidateKey: null }), card);
  assert.match(preview.text, /Data unavailable/);
  assert.doesNotMatch(preview.text, /210/);
});

test("READY without a complete card fails closed", () => {
  const preview = buildCandidateStyleTelegramPreview(result(), null);
  assert.match(preview.text, /nothing executable shown/);
  assert.equal(preview.executablePlanShown, false);
});

test("selector/card side mismatch fails closed", () => {
  const peCard: CandidateStyleReadyCard = { ...card, decision: "BEST_PE", label: "SELL" };
  const preview = buildCandidateStyleTelegramPreview(result(), peCard);
  assert.match(preview.text, /side or label mismatch/);
  assert.doesNotMatch(preview.text, /Entry:/);
});

test("selector/card label mismatch fails closed", () => {
  const badLabel: CandidateStyleReadyCard = { ...card, label: "SELL" };
  const preview = buildCandidateStyleTelegramPreview(result(), badLabel);
  assert.match(preview.text, /side or label mismatch/);
  assert.equal(preview.executablePlanShown, false);
});

for (const [name, changed] of [
  ["symbol", { symbol: "BANKNIFTY" }],
  ["strike", { strike: 25100 }],
  ["dte", { dte: 5 }],
  ["expiry", { expiryDate: "2026-09-10" }],
] as const) {
  test(`selector/card ${name} mismatch fails closed`, () => {
    const badCard: CandidateStyleReadyCard = { ...card, ...changed };
    const preview = buildCandidateStyleTelegramPreview(result(), badCard);
    assert.match(preview.text, /contract identity mismatch/);
    assert.doesNotMatch(preview.text, /Entry:/);
    assert.equal(preview.executablePlanShown, false);
  });
}

test("upstream blocked caller card cannot retain outer READY state", () => {
  const blockedCard: CandidateStyleReadyCard = { ...card, blockStatus: { blocked: true, reasons: ["RISK"] } };
  const preview = buildCandidateStyleTelegramPreview(result(), blockedCard);
  assert.match(preview.text, /BLOCKED/);
  assert.doesNotMatch(preview.text, /• READY/);
  assert.doesNotMatch(preview.text, /Entry:/);
  assert.equal(preview.executablePlanShown, false);
});

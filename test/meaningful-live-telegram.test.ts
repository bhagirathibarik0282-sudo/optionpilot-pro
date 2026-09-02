import test from "node:test";
import assert from "node:assert/strict";
import {
  MeaningfulConfirmationTracker,
  attributeMarketFootprintConservatively,
  buildFootprintEvents,
  deriveLiveMeaningfulDecision,
  isMeaningfulBridgeOwnedTelegramText,
  syntheticSuppressedResponse,
  toTelegramHtml,
  type LiveNarrativeWindow,
  type LivePremiumPoint,
} from "../meaningful-live-telegram.ts";

function premium(
  atMs: number,
  side: "CE" | "PE",
  ltp: number,
  expiry = "2026-09-03",
  strike = 24050,
  dte = 1,
): LivePremiumPoint {
  return {
    atMs,
    contractKey: `NIFTY|${expiry}|${strike}|${side}`,
    side,
    expiry,
    dte,
    strike,
    ltp,
    pdh: 32.1,
    pdl: 12,
    validationStatus: "VALID",
  };
}

function bullishWindow(): LiveNarrativeWindow {
  return {
    symbol: "NIFTY",
    market: [
      { atMs: 2_000, atLabel: "14:44 IST", freshnessStatus: "TRUE", spot: 24080, future: 24110, pdh: 24150, pdl: 23980 },
      { atMs: 4_000, atLabel: "14:45 IST", freshnessStatus: "TRUE", spot: 24138, future: 24178, pdh: 24150, pdl: 23980 },
    ],
    chain: [
      { atMs: 1_000, validationStatus: "VALID", pcr: 0.841, callWallStrike: 24100, callWallOi: 46_580_000, putWallStrike: 24000, putWallOi: 36_996_000 },
      { atMs: 3_000, validationStatus: "VALID", pcr: 1.028, callWallStrike: 24100, callWallOi: 28_595_000, putWallStrike: 24000, putWallOi: 37_198_000 },
    ],
    candidate: [premium(3_100, "CE", 21.8), premium(4_100, "CE", 31.5)],
    opposite: [premium(3_100, "PE", 18.4, "2026-09-03", 24000), premium(4_100, "PE", 12.1, "2026-09-03", 24000)],
    nextDte: [premium(3_200, "CE", 50, "2026-09-10", 24050, 8), premium(4_200, "CE", 55.4, "2026-09-10", 24050, 8)],
  };
}

test("live engine produces a linked-ready bullish release when OI layer leads and price follows", () => {
  const r = deriveLiveMeaningfulDecision(bullishWindow(), null);
  assert.equal(r.ok, true);
  assert.equal(r.direction, "BULLISH");
  assert.equal(r.state, "BULLISH_RELEASE");
  assert.equal(r.footprint?.leader, "OI_WALL_LED");
  assert.equal(r.crossDteSupporting, true);
  assert.match(r.narrativeText ?? "", /NIFTY 24,080\.00→24,138\.00 ↑ \+58\.00 \(\+0\.24%\)/);
  assert.match(r.narrativeText ?? "", /CARTED \/ WATCH/);
  assert.match(r.narrativeText ?? "", /NOT TRADE EXECUTION/);
  assert.doesNotMatch(r.narrativeText ?? "", /DATA CONFLICTING/i);
});

test("same-timestamp leadership tie is not force-ranked", () => {
  const w = bullishWindow();
  w.chain[1].atMs = 4_000;
  w.candidate[0].atMs = 3_000;
  w.candidate[1].atMs = 4_000;
  const events = buildFootprintEvents(w, "BULLISH");
  const r = attributeMarketFootprintConservatively("NIFTY", "BULLISH", null, events);
  assert.equal(r.leader, "UNRESOLVED");
  assert.equal(r.reason, "LEAD_TIMESTAMP_TIE_UNRESOLVED");
});

test("candidate and opposite premium expansion becomes dual-premium energy, not generic conflict", () => {
  const w = bullishWindow();
  w.opposite = [premium(3_100, "PE", 12.1, "2026-09-03", 24000), premium(4_100, "PE", 14.8, "2026-09-03", 24000)];
  const r = deriveLiveMeaningfulDecision(w, null);
  assert.equal(r.state, "DUAL_PREMIUM_ENERGY");
  assert.equal(r.oppositeState, "RECOVERING");
  assert.doesNotMatch(r.narrativeText ?? "", /CONFLICT/i);
});

test("stale data blocks promotion in the narrative layer", () => {
  const w = bullishWindow();
  w.market[w.market.length - 1].freshnessStatus = "STALE";
  const r = deriveLiveMeaningfulDecision(w, null);
  assert.equal(r.dataQuality, "STALE");
  assert.equal(r.state, "DATA_QUALITY_BLOCKED");
  assert.ok(r.meaningfulChanges.some((x) => x.includes("DATA QUALITY STALE")));
});

test("opposite lower-low failure plus candidate fade is exhaustion watch", () => {
  const w = bullishWindow();
  w.candidate = [premium(2_100, "CE", 30), premium(3_100, "CE", 32), premium(4_100, "CE", 31.5)];
  w.opposite = [
    premium(2_100, "PE", 18.4, "2026-09-03", 24000),
    premium(3_100, "PE", 12.1, "2026-09-03", 24000),
    premium(4_100, "PE", 14.8, "2026-09-03", 24000),
  ];
  const r = deriveLiveMeaningfulDecision(w, null);
  assert.equal(r.state, "EXHAUSTION_WATCH");
  assert.match(r.oppositeState ?? "", /LL FAILURE/);
});

test("previous per-index state is linked and footprint rotation is explicit", () => {
  const w = bullishWindow();
  const previous = {
    symbol: "NIFTY" as const,
    state: "BULLISH_TRANSITION" as const,
    stateSinceMs: 1_000,
    lastMeaningfulAtMs: 2_000,
    lastMessageId: "NIFTY:2000",
    candidateKey: w.candidate.at(-1)!.contractKey,
    oppositeKey: w.opposite.at(-1)!.contractKey,
    footprintLeader: "FUTURES_LED" as const,
    fingerprint: `${w.candidate.at(-1)!.contractKey}:old`,
  };
  const r = deriveLiveMeaningfulDecision(w, previous);
  assert.equal(r.footprint?.rotationDetected, true);
  assert.ok(r.meaningfulChanges.some((x) => x.includes("FOOTPRINT ROTATION")));
  assert.match(r.narrativeText ?? "", /Linked:/);
});

test("HTML conversion preserves verified values and renders bold sections", () => {
  const html = toTelegramHtml("**NIFTY • BULLISH RELEASE**\nNIFTY 24,080→24,138 ↑ +58 (+0.24%)");
  assert.equal(html, "<b>NIFTY • BULLISH RELEASE</b>\nNIFTY 24,080→24,138 ↑ +58 (+0.24%)");
});

test("confirmation tracker requires the same meaningful state key to persist", () => {
  const tracker = new MeaningfulConfirmationTracker();
  assert.equal(tracker.observe("NIFTY", "A"), 1);
  assert.equal(tracker.observe("NIFTY", "A"), 2);
  assert.equal(tracker.observe("NIFTY", "B"), 1);
  assert.equal(tracker.observe("SENSEX", "A"), 1);
  assert.equal(tracker.observe("NIFTY", "B"), 2);
  tracker.reset("NIFTY");
  assert.equal(tracker.observe("NIFTY", "B"), 1);
});


test("meaningful bridge suppression response blocks legacy minute-card pass-through", async () => {
  const response = syntheticSuppressedResponse();
  assert.equal(response.ok, true);
  const body = await response.json() as { ok?: boolean; result?: { text?: string } };
  assert.equal(body.ok, true);
  assert.equal(body.result?.text, "OPTIONPILOT_MEANINGFUL_SUPPRESSED_UNCHANGED");
});

test("meaningful bridge owns standalone legacy alerts that lack PCR/OI/premium markers", () => {
  assert.equal(isMeaningfulBridgeOwnedTelegramText(
    "📊 <b>REGIME SHIFT — NIFTY</b>\nRANGE_COMPRESSION_PROVISIONAL → OSCILLATING_OR_RANGE",
  ), true);
  assert.equal(isMeaningfulBridgeOwnedTelegramText(
    "💡 <b>Why this matters (NIFTY)</b>\nBoth metrics signal that call buyers are struggling.",
  ), true);
  assert.equal(isMeaningfulBridgeOwnedTelegramText(
    "📈 <b>HIGH-CONVICTION EVIDENCE — NIFTY</b>\nReadiness: EVIDENCE_MATRIX_COMPLETE | Conflicts: 0",
  ), true);
  assert.equal(isMeaningfulBridgeOwnedTelegramText(
    "⛔ <b>NIFTY | NO TRADE</b>\nReason: REVIEWABLE_CONTRACT: Selected ATM/1-ITM contract must have complete live quote/liquidity data.",
  ), true);
});

test("meaningful bridge does not recapture consolidated output or unrelated Telegram text", () => {
  assert.equal(isMeaningfulBridgeOwnedTelegramText("🧭 OPTIONPILOT MEANINGFUL V1\nNIFTY • BULLISH PRESSURE"), false);
  assert.equal(isMeaningfulBridgeOwnedTelegramText("Manual operator note for NIFTY"), false);
});

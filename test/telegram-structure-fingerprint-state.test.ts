import assert from "node:assert/strict";
import { TelegramStructureFingerprintState } from "../telegram-structure-fingerprint-state.js";

const state = new TelegramStructureFingerprintState();

assert.equal(state.shouldEmit("NIFTY", "STRUCTURE_BLOCK", "NO_TRADE|REVIEWABLE_CONTRACT"), true);
state.markEmitted("NIFTY", "STRUCTURE_BLOCK", "NO_TRADE|REVIEWABLE_CONTRACT");
assert.equal(state.shouldEmit("NIFTY", "STRUCTURE_BLOCK", "NO_TRADE|REVIEWABLE_CONTRACT"), false);

assert.equal(state.shouldEmit("NIFTY", "RISK_BLOCK", "NO_TRADE_RISK|500"), true);
state.markEmitted("NIFTY", "RISK_BLOCK", "NO_TRADE_RISK|500");
assert.equal(state.shouldEmit("NIFTY", "STRUCTURE_BLOCK", "NO_TRADE|REVIEWABLE_CONTRACT"), false);
assert.equal(state.shouldEmit("NIFTY", "RISK_BLOCK", "NO_TRADE_RISK|500"), false);

assert.equal(state.shouldEmit("NIFTY", "CANDIDATE", "BEST_PE|23900|123.3"), true);
state.markEmitted("NIFTY", "CANDIDATE", "BEST_PE|23900|123.3");
assert.equal(state.shouldEmit("NIFTY", "RISK_BLOCK", "NO_TRADE_RISK|500"), false);

assert.equal(state.shouldEmit("NIFTY", "RISK_BLOCK", "NO_TRADE_RISK|650"), true);
assert.equal(state.shouldEmit("SENSEX", "RISK_BLOCK", "NO_TRADE_RISK|500"), true);

state.clear();
assert.equal(state.shouldEmit("NIFTY", "STRUCTURE_BLOCK", "NO_TRADE|REVIEWABLE_CONTRACT"), true);

console.log("telegram structure fingerprint state tests passed");

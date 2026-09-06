import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  ingestCanonicalOfficialUniverseSources,
  type CanonicalOfficialUniverseSourceBundle,
} from "../canonical-official-universe-ingest.js";

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function bundle(
  symbol: CanonicalOfficialUniverseSourceBundle["symbol"],
  csvContent: string,
): CanonicalOfficialUniverseSourceBundle {
  const bySymbol = {
    NIFTY: {
      operatingMode: "BUYER_ELIGIBLE" as const,
      sourceUrl: "https://www.niftyindices.com/Factsheet/ind_nifty50.csv",
    },
    SENSEX: {
      operatingMode: "BUYER_ELIGIBLE" as const,
      sourceUrl: "https://www.bseindices.com/indices/SENSEX.csv",
    },
    BANKNIFTY: {
      operatingMode: "OBSERVATION_ONLY_MONTHLY" as const,
      sourceUrl: "https://www.niftyindices.com/Factsheet/ind_niftybank.csv",
    },
  }[symbol];
  return {
    symbol,
    ...bySymbol,
    sourceAsOfDate: "2026-08-31",
    sourceSha256: sha256(csvContent),
    expectedConstituentCount: 2,
    csvContent,
  };
}

const niftyCsv = "Symbol,Sector,Weight\nRELIANCE,ENERGY,60\nHDFCBANK,BANK,40\n";
const sensexCsv = "Symbol,Sector,Weight\nICICIBANK,BANK,45\nRELIANCE,ENERGY,55\n";
const bankNiftyCsv = "Symbol,Sector,Weight\nHDFCBANK,BANK,55\nICICIBANK,BANK,45\n";

function validInput() {
  return {
    manifestId: "official-index-universe-2026-08-31",
    generatedAt: "2026-09-06T01:00:00.000Z",
    asOfDate: "2026-09-06",
    maxSourceAgeDays: 10,
    sources: [
      bundle("NIFTY", niftyCsv),
      bundle("SENSEX", sensexCsv),
      bundle("BANKNIFTY", bankNiftyCsv),
    ],
  };
}

test("ingests only hash-verified complete official source bundles", () => {
  const out = ingestCanonicalOfficialUniverseSources(validInput());
  assert.equal(out.ready, true);
  assert.equal(out.sourceHashesVerified, true);
  assert.equal(out.parsedRowCount, 6);
  assert.equal(out.manifestHash?.length, 64);
  assert.equal(out.manifest?.scopes.length, 3);
  assert.equal(out.readOnly, true);
  assert.equal(out.activatesRuntime, false);
  assert.equal(out.selectsConstituents, false);
  assert.equal(out.affectsDirection, false);
  assert.equal(out.affectsVerdict, false);
  assert.equal(out.affectsExecution, false);
  assert.equal(out.affectsTelegram, false);
  assert.equal(out.failClosed, true);
});

test("fails closed before parsing when exact source bytes do not match SHA-256", () => {
  const input = validInput();
  input.sources[0].sourceSha256 = "0".repeat(64);
  const out = ingestCanonicalOfficialUniverseSources(input);
  assert.equal(out.ready, false);
  assert.equal(out.sourceHashesVerified, false);
  assert.equal(out.manifest, null);
  assert.ok(out.blockers.includes("OFFICIAL_UNIVERSE_SOURCE_HASH_MISMATCH:NIFTY"));
});

test("fails closed on malformed or ambiguous CSV structure", () => {
  const ambiguous = "Symbol,Ticker,Sector,Weight\nRELIANCE,RELIANCE,ENERGY,60\nHDFCBANK,HDFCBANK,BANK,40\n";
  const input = validInput();
  input.sources[0] = bundle("NIFTY", ambiguous);
  const out = ingestCanonicalOfficialUniverseSources(input);
  assert.equal(out.ready, false);
  assert.ok(out.blockers.includes("OFFICIAL_UNIVERSE_CSV_SYMBOL_HEADER_AMBIGUOUS"));

  const malformed = 'Symbol,Sector,Weight\n"RELIANCE,ENERGY,60\nHDFCBANK,BANK,40\n';
  const second = validInput();
  second.sources[0] = bundle("NIFTY", malformed);
  const malformedOut = ingestCanonicalOfficialUniverseSources(second);
  assert.equal(malformedOut.ready, false);
  assert.ok(malformedOut.blockers.includes("OFFICIAL_UNIVERSE_CSV_UNCLOSED_QUOTE"));
});

test("delegates exact count, duplicate constituent and weight reconciliation fail-closed checks", () => {
  const input = validInput();
  input.sources[0].expectedConstituentCount = 3;
  const duplicateBadWeight = "Symbol,Sector,Weight\nRELIANCE,ENERGY,60\nRELIANCE,ENERGY,20\n";
  input.sources[1] = bundle("SENSEX", duplicateBadWeight);
  const out = ingestCanonicalOfficialUniverseSources(input);
  assert.equal(out.ready, false);
  assert.ok(out.blockers.includes("OFFICIAL_UNIVERSE_COUNT_MISMATCH:NIFTY"));
  assert.ok(out.blockers.includes("OFFICIAL_UNIVERSE_DUPLICATE_CONSTITUENT:SENSEX:RELIANCE"));
  assert.ok(out.blockers.includes("OFFICIAL_UNIVERSE_WEIGHT_TOTAL_INVALID:SENSEX"));
});

test("delegates stale and future source-date bounds without activating runtime", () => {
  const input = validInput();
  input.sources[0].sourceAsOfDate = "2026-08-01";
  input.sources[1].sourceAsOfDate = "2026-09-07";
  const out = ingestCanonicalOfficialUniverseSources(input);
  assert.equal(out.ready, false);
  assert.ok(out.blockers.includes("OFFICIAL_UNIVERSE_SOURCE_STALE:NIFTY"));
  assert.ok(out.blockers.includes("OFFICIAL_UNIVERSE_SOURCE_FUTURE_DATED:SENSEX"));
  assert.equal(out.activatesRuntime, false);
  assert.equal(out.affectsTelegram, false);
  assert.equal(out.affectsExecution, false);
});

import assert from "node:assert/strict";
import test from "node:test";
import { CANONICAL_OFFICIAL_INDEX_UNIVERSE_FREEZE_V1, validateCanonicalOfficialUniverseManifest, type CanonicalOfficialUniverseManifest } from "../canonical-official-index-universe-freeze.js";

const hash = "a".repeat(64);
function manifest(): CanonicalOfficialUniverseManifest {
  return {
    version: CANONICAL_OFFICIAL_INDEX_UNIVERSE_FREEZE_V1,
    manifestId: "official-index-universe-2026-08-31",
    generatedAt: "2026-09-06T01:00:00.000Z",
    scopes: [
      {
        symbol: "NIFTY", operatingMode: "BUYER_ELIGIBLE",
        sourceUrl: "https://www.niftyindices.com/Factsheet/ind_nifty50.pdf",
        sourceAsOfDate: "2026-08-31", sourceSha256: hash, expectedConstituentCount: 2,
        entries: [
          { tradingsymbol: "RELIANCE", sector: "ENERGY", weightPct: 60 },
          { tradingsymbol: "HDFCBANK", sector: "BANK", weightPct: 40 },
        ],
      },
      {
        symbol: "SENSEX", operatingMode: "BUYER_ELIGIBLE",
        sourceUrl: "https://www.bseindices.com/indices/SENSEX",
        sourceAsOfDate: "2026-08-31", sourceSha256: "b".repeat(64), expectedConstituentCount: 2,
        entries: [
          { tradingsymbol: "ICICIBANK", sector: "BANK", weightPct: 45 },
          { tradingsymbol: "RELIANCE", sector: "ENERGY", weightPct: 55 },
        ],
      },
      {
        symbol: "BANKNIFTY", operatingMode: "OBSERVATION_ONLY_MONTHLY",
        sourceUrl: "https://www.niftyindices.com/Factsheet/ind_niftybank.pdf",
        sourceAsOfDate: "2026-08-31", sourceSha256: "c".repeat(64), expectedConstituentCount: 2,
        entries: [
          { tradingsymbol: "HDFCBANK", sector: "BANK", weightPct: 55 },
          { tradingsymbol: "ICICIBANK", sector: "BANK", weightPct: 45 },
        ],
      },
    ],
  };
}
const options = { asOfDate: "2026-09-06", maxSourceAgeDays: 10 };

test("freezes reconciled official universes with required operating modes", () => {
  const out = validateCanonicalOfficialUniverseManifest(manifest(), options);
  assert.equal(out.ready, true);
  assert.equal(out.manifestHash?.length, 64);
  assert.equal(out.manifest?.scopes.find((x) => x.symbol === "NIFTY")?.operatingMode, "BUYER_ELIGIBLE");
  assert.equal(out.manifest?.scopes.find((x) => x.symbol === "SENSEX")?.operatingMode, "BUYER_ELIGIBLE");
  assert.equal(out.manifest?.scopes.find((x) => x.symbol === "BANKNIFTY")?.operatingMode, "OBSERVATION_ONLY_MONTHLY");
  assert.equal(out.activatesRuntime, false);
  assert.equal(out.affectsExecution, false);
  assert.equal(out.affectsTelegram, false);
  assert.equal(out.failClosed, true);
});

test("canonical hash is stable regardless of scope and entry ordering", () => {
  const first = manifest();
  const second = manifest();
  second.scopes.reverse();
  for (const scope of second.scopes) scope.entries.reverse();
  const a = validateCanonicalOfficialUniverseManifest(first, options);
  const b = validateCanonicalOfficialUniverseManifest(second, options);
  assert.equal(a.ready, true);
  assert.equal(a.manifestHash, b.manifestHash);
});

test("rejects unofficial domains and source hash failures", () => {
  const input = manifest();
  input.scopes[0].sourceUrl = "https://niftyindices.com.attacker.example/file.csv";
  input.scopes[1].sourceSha256 = "not-a-hash";
  const out = validateCanonicalOfficialUniverseManifest(input, options);
  assert.equal(out.ready, false);
  assert.equal(out.manifest, null);
  assert.ok(out.blockers.includes("OFFICIAL_UNIVERSE_SOURCE_INVALID:NIFTY"));
  assert.ok(out.blockers.includes("OFFICIAL_UNIVERSE_SOURCE_HASH_INVALID:SENSEX"));
});

test("rejects stale, future-dated and incomplete scope evidence", () => {
  const input = manifest();
  input.scopes[0].sourceAsOfDate = "2026-08-01";
  input.scopes[1].sourceAsOfDate = "2026-09-07";
  input.scopes = input.scopes.filter((scope) => scope.symbol !== "BANKNIFTY");
  const out = validateCanonicalOfficialUniverseManifest(input, options);
  assert.equal(out.ready, false);
  assert.ok(out.blockers.includes("OFFICIAL_UNIVERSE_SOURCE_STALE:NIFTY"));
  assert.ok(out.blockers.includes("OFFICIAL_UNIVERSE_SOURCE_FUTURE_DATED:SENSEX"));
  assert.ok(out.blockers.includes("OFFICIAL_UNIVERSE_SCOPE_MISSING:BANKNIFTY"));
});

test("rejects weight, count, duplicate and operating-mode contract violations", () => {
  const input = manifest();
  input.scopes[0].entries[1].tradingsymbol = "RELIANCE";
  input.scopes[0].entries[1].weightPct = 20;
  input.scopes[1].expectedConstituentCount = 3;
  input.scopes[2].operatingMode = "BUYER_ELIGIBLE";
  const out = validateCanonicalOfficialUniverseManifest(input, options);
  assert.equal(out.ready, false);
  assert.ok(out.blockers.includes("OFFICIAL_UNIVERSE_DUPLICATE_CONSTITUENT:NIFTY:RELIANCE"));
  assert.ok(out.blockers.includes("OFFICIAL_UNIVERSE_WEIGHT_TOTAL_INVALID:NIFTY"));
  assert.ok(out.blockers.includes("OFFICIAL_UNIVERSE_COUNT_MISMATCH:SENSEX"));
  assert.ok(out.blockers.includes("OFFICIAL_UNIVERSE_MODE_INVALID:BANKNIFTY"));
});

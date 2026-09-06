import assert from "node:assert/strict";
import test from "node:test";
import {
  CANONICAL_HEAVYWEIGHT_SECTOR_SELECTION_POLICY_V1,
  buildCanonicalHeavyweightSectorSelection,
} from "../canonical-heavyweight-sector-selection-policy.js";
import {
  CANONICAL_OFFICIAL_INDEX_UNIVERSE_FREEZE_V1,
  type CanonicalOfficialUniverseValidation,
} from "../canonical-official-index-universe-freeze.js";

function verifiedUniverse(): CanonicalOfficialUniverseValidation {
  return {
    version: CANONICAL_OFFICIAL_INDEX_UNIVERSE_FREEZE_V1,
    ready: true,
    manifestHash: "a".repeat(64),
    manifest: {
      version: CANONICAL_OFFICIAL_INDEX_UNIVERSE_FREEZE_V1,
      manifestId: "fixture",
      generatedAt: "2026-09-06T00:00:00.000Z",
      scopes: [
        {
          symbol: "NIFTY",
          operatingMode: "BUYER_ELIGIBLE",
          sourceUrl: "https://niftyindices.com/nifty.csv",
          sourceAsOfDate: "2026-09-05",
          sourceSha256: "1".repeat(64),
          expectedConstituentCount: 3,
          entries: [
            { tradingsymbol: "BBB", sector: "BANK", weightPct: 40 },
            { tradingsymbol: "AAA", sector: "ENERGY", weightPct: 40 },
            { tradingsymbol: "CCC", sector: "IT", weightPct: 20 },
          ],
        },
        {
          symbol: "SENSEX",
          operatingMode: "BUYER_ELIGIBLE",
          sourceUrl: "https://bseindices.com/sensex.csv",
          sourceAsOfDate: "2026-09-05",
          sourceSha256: "2".repeat(64),
          expectedConstituentCount: 2,
          entries: [
            { tradingsymbol: "DDD", sector: "BANK", weightPct: 60 },
            { tradingsymbol: "EEE", sector: "IT", weightPct: 40 },
          ],
        },
        {
          symbol: "BANKNIFTY",
          operatingMode: "OBSERVATION_ONLY_MONTHLY",
          sourceUrl: "https://niftyindices.com/banknifty.csv",
          sourceAsOfDate: "2026-09-05",
          sourceSha256: "3".repeat(64),
          expectedConstituentCount: 2,
          entries: [
            { tradingsymbol: "FFF", sector: "PRIVATE_BANK", weightPct: 55 },
            { tradingsymbol: "GGG", sector: "PRIVATE_BANK", weightPct: 45 },
          ],
        },
      ],
    },
    blockers: [],
    readOnly: true,
    frozenEvidenceOnly: true,
    activatesRuntime: false,
    affectsDirection: false,
    affectsVerdict: false,
    affectsExecution: false,
    affectsTelegram: false,
    failClosed: true,
  };
}

const config = {
  heavyweightCount: { NIFTY: 1, SENSEX: 1, BANKNIFTY: 1 },
  sectorMethod: "ALL_OFFICIAL_CONSTITUENTS" as const,
};

test("selects deterministic top-K heavyweights and all official constituents for sector breadth", () => {
  const out = buildCanonicalHeavyweightSectorSelection(verifiedUniverse(), config);
  assert.equal(out.version, CANONICAL_HEAVYWEIGHT_SECTOR_SELECTION_POLICY_V1);
  assert.equal(out.ready, true);
  assert.equal(out.sourceManifestHash, "a".repeat(64));
  assert.equal(out.heavyweightMethod, "TOP_K_OFFICIAL_WEIGHT_DESC_SYMBOL_ASC");
  assert.equal(out.sectorMethod, "ALL_OFFICIAL_CONSTITUENTS");

  const niftyHeavyweights = out.requests.filter((row) => row.parentSymbol === "NIFTY" && row.role === "HEAVYWEIGHT");
  assert.deepEqual(niftyHeavyweights.map((row) => row.tradingsymbol), ["AAA"]);
  assert.equal(niftyHeavyweights[0].weight, 40);

  const niftySector = out.requests.filter((row) => row.parentSymbol === "NIFTY" && row.role === "SECTOR_CONSTITUENT");
  assert.deepEqual(niftySector.map((row) => row.tradingsymbol), ["AAA", "BBB", "CCC"]);
  assert.equal(niftySector.length, 3);
});

test("preserves buyer eligibility and BANKNIFTY observation-only monthly mode", () => {
  const out = buildCanonicalHeavyweightSectorSelection(verifiedUniverse(), config);
  const modes = Object.fromEntries(out.scopes.map((scope) => [scope.symbol, scope.operatingMode]));
  assert.equal(modes.NIFTY, "BUYER_ELIGIBLE");
  assert.equal(modes.SENSEX, "BUYER_ELIGIBLE");
  assert.equal(modes.BANKNIFTY, "OBSERVATION_ONLY_MONTHLY");
  assert.equal(out.scopes.find((scope) => scope.symbol === "NIFTY")?.heavyweightWeightCoveragePct, 40);
});

test("fails closed when official universe is not verified or policy config is invalid", () => {
  const unready = verifiedUniverse();
  unready.ready = false;
  unready.manifest = null;
  unready.manifestHash = null;
  const blocked = buildCanonicalHeavyweightSectorSelection(unready, config);
  assert.equal(blocked.ready, false);
  assert.deepEqual(blocked.requests, []);
  assert.match(blocked.blockers.join("|"), /CANONICAL_SELECTION_OFFICIAL_UNIVERSE_NOT_READY/);

  const invalidCount = buildCanonicalHeavyweightSectorSelection(verifiedUniverse(), {
    ...config,
    heavyweightCount: { NIFTY: 0, SENSEX: 1, BANKNIFTY: 1 },
  });
  assert.equal(invalidCount.ready, false);
  assert.match(invalidCount.blockers.join("|"), /CANONICAL_SELECTION_HEAVYWEIGHT_COUNT_INVALID:NIFTY/);

  const exceeds = buildCanonicalHeavyweightSectorSelection(verifiedUniverse(), {
    ...config,
    heavyweightCount: { NIFTY: 99, SENSEX: 1, BANKNIFTY: 1 },
  });
  assert.equal(exceeds.ready, false);
  assert.match(exceeds.blockers.join("|"), /CANONICAL_SELECTION_HEAVYWEIGHT_COUNT_EXCEEDS_UNIVERSE:NIFTY/);
});

test("selection layer remains read-only and grants no direction, candidate, execution or Telegram authority", () => {
  const out = buildCanonicalHeavyweightSectorSelection(verifiedUniverse(), config);
  assert.equal(out.readOnly, true);
  assert.equal(out.deterministic, true);
  assert.equal(out.infersMembership, false);
  assert.equal(out.activatesRuntime, false);
  assert.equal(out.affectsDirection, false);
  assert.equal(out.affectsVerdict, false);
  assert.equal(out.grantsCandidateAuthority, false);
  assert.equal(out.affectsExecution, false);
  assert.equal(out.affectsTelegram, false);
  assert.equal(out.failClosed, true);
});

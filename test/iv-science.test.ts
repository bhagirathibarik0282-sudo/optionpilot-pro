import test from "node:test";
import assert from "node:assert/strict";
import { buildF5IvScience, type IvScienceInputRow } from "../iv-science.js";

function row(overrides: Partial<IvScienceInputRow> = {}): IvScienceInputRow {
  return {
    timestamp: "2026-08-11T09:15:00.000Z",
    expiry: "2026-08-18",
    strike: 24_500,
    optionType: "CE",
    dynamicAtmOffset: 0,
    iv: 12,
    ...overrides,
  };
}

test("IV quality gate never treats missing, zero, negative, text, or non-finite IV as valid", () => {
  const result = buildF5IvScience([
    row({ iv: undefined }),
    row({ timestamp: "2026-08-11T09:16:00.000Z", iv: 0 }),
    row({ timestamp: "2026-08-11T09:17:00.000Z", iv: -1 }),
    row({ timestamp: "2026-08-11T09:18:00.000Z", iv: "12" }),
    row({ timestamp: "2026-08-11T09:19:00.000Z", iv: Number.POSITIVE_INFINITY }),
  ]);

  assert.equal(result.status, "BLOCKED");
  assert.equal(result.blockerCode, "NO_VALID_HISTORICAL_IV");
  assert.equal(result.qualitySummary.missingIvCount, 1);
  assert.equal(result.qualitySummary.zeroIvAnomalyCount, 1);
  assert.equal(result.qualitySummary.negativeIvCount, 1);
  assert.equal(result.qualitySummary.nonNumericIvCount, 1);
  assert.equal(result.qualitySummary.nonFiniteIvCount, 1);
  assert.equal(result.qualitySummary.validIvCount, 0);
});

test("change, velocity, and acceleration stay inside one fixed contract", () => {
  const result = buildF5IvScience([
    row({ timestamp: "2026-08-11T09:15:00.000Z", iv: 12 }),
    row({ timestamp: "2026-08-11T09:16:00.000Z", iv: 13 }),
    row({ timestamp: "2026-08-11T09:17:00.000Z", iv: 15 }),
    row({ timestamp: "2026-08-11T09:15:00.000Z", strike: 24_550, iv: 20 }),
  ]);

  const ce24500 = result.perContract.filter((feature) => feature.strike === 24_500);
  assert.equal(ce24500[0].ivChange, null);
  assert.equal(ce24500[0].ivChangeQuality, "UNAVAILABLE_FIRST_OBSERVATION");
  assert.equal(ce24500[1].ivChange, 1);
  assert.equal(ce24500[1].ivVelocityPerMinute, 1);
  assert.equal(ce24500[1].ivAccelerationPerMinute2, null);
  assert.equal(ce24500[1].ivAccelerationQuality, "UNAVAILABLE_PREVIOUS_VELOCITY");
  assert.equal(ce24500[2].ivChange, 2);
  assert.equal(ce24500[2].ivVelocityPerMinute, 2);
  assert.equal(ce24500[2].ivAccelerationPerMinute2, 1);

  const ce24550 = result.perContract.find((feature) => feature.strike === 24_550)!;
  assert.equal(ce24550.ivChange, null);
  assert.equal(ce24550.ivChangeQuality, "UNAVAILABLE_FIRST_OBSERVATION");
});

test("invalid IV breaks continuity; the engine does not jump over the bad observation", () => {
  const result = buildF5IvScience([
    row({ timestamp: "2026-08-11T09:15:00.000Z", iv: 12 }),
    row({ timestamp: "2026-08-11T09:16:00.000Z", iv: null }),
    row({ timestamp: "2026-08-11T09:17:00.000Z", iv: 14 }),
  ]);

  assert.equal(result.perContract[1].ivChangeQuality, "UNAVAILABLE_CURRENT_IV_INVALID");
  assert.equal(result.perContract[2].ivChange, null);
  assert.equal(result.perContract[2].ivChangeQuality, "UNAVAILABLE_PREVIOUS_IV_INVALID");
});

test("a missing one-minute candle is a cadence gap, not a continuous IV move", () => {
  const result = buildF5IvScience([
    row({ timestamp: "2026-08-11T09:15:00.000Z", iv: 12 }),
    row({ timestamp: "2026-08-11T09:17:00.000Z", iv: 14 }),
  ]);

  assert.equal(result.qualitySummary.cadenceGapCount, 1);
  assert.equal(result.perContract[1].ivChange, null);
  assert.equal(result.perContract[1].ivChangeQuality, "UNAVAILABLE_CADENCE_GAP");
});

test("full ATM±3 CE/PE universe produces valid IV range and dispersion", () => {
  const rows: IvScienceInputRow[] = [];
  let iv = 10;
  for (const offset of [-3, -2, -1, 0, 1, 2, 3]) {
    for (const optionType of ["CE", "PE"] as const) {
      rows.push(row({ strike: 24_500 + offset * 50, dynamicAtmOffset: offset, optionType, iv: iv++ }));
    }
  }

  const result = buildF5IvScience(rows);
  assert.equal(result.status, "PASS");
  assert.equal(result.crossSection.length, 1);
  assert.equal(result.crossSection[0].quality, "VALID_FULL_UNIVERSE");
  assert.equal(result.crossSection[0].validIvCount, 14);
  assert.equal(result.crossSection[0].ivMin, 10);
  assert.equal(result.crossSection[0].ivMax, 23);
  assert.equal(result.crossSection[0].ivRange, 13);
  assert.ok((result.crossSection[0].ivDispersion ?? 0) > 0);
});

test("cross-sectional statistics use only valid IV and are explicitly PARTIAL", () => {
  const result = buildF5IvScience([
    row({ strike: 24_450, dynamicAtmOffset: -1, optionType: "CE", iv: 10 }),
    row({ strike: 24_450, dynamicAtmOffset: -1, optionType: "PE", iv: 14 }),
    row({ strike: 24_500, dynamicAtmOffset: 0, optionType: "CE", iv: 0 }),
  ]);

  assert.equal(result.status, "PARTIAL");
  assert.equal(result.crossSection[0].quality, "PARTIAL_VALID_SUBSET");
  assert.equal(result.crossSection[0].validIvCount, 2);
  assert.equal(result.crossSection[0].ivRange, 4);
  assert.equal(result.crossSection[0].ivMean, 12);
  assert.equal(result.crossSection[0].ivDispersion, 2);
});

test("rows outside the required dynamic ATM±3 universe are excluded", () => {
  const result = buildF5IvScience([
    row({ dynamicAtmOffset: -4, strike: 24_300, iv: 99 }),
    row({ dynamicAtmOffset: 0, strike: 24_500, iv: 12 }),
  ]);

  assert.equal(result.qualitySummary.totalInputRows, 2);
  assert.equal(result.qualitySummary.requiredUniverseRows, 1);
  assert.equal(result.qualitySummary.validIvCount, 1);
  assert.equal(result.perContract.some((feature) => feature.strike === 24_300), false);
});

test("a duplicate timestamp also blocks the immediately following derivative", () => {
  const result = buildF5IvScience([
    row({ timestamp: "2026-08-11T09:15:00.000Z", iv: 12 }),
    row({ timestamp: "2026-08-11T09:16:00.000Z", iv: 13 }),
    row({ timestamp: "2026-08-11T09:16:00.000Z", iv: 99 }),
    row({ timestamp: "2026-08-11T09:17:00.000Z", iv: 14 }),
  ]);

  const following = result.perContract.find((feature) => feature.timestamp === "2026-08-11T09:17:00.000Z")!;
  assert.equal(result.qualitySummary.duplicateTimestampCount, 2);
  assert.equal(following.ivChange, null);
  assert.equal(following.ivChangeQuality, "UNAVAILABLE_PREVIOUS_TIMESTAMP_DUPLICATE");
});

test("a full-looking 14-contract basket is PARTIAL when ATM offsets or expiry identity are wrong", () => {
  const rows: IvScienceInputRow[] = [];
  let iv = 10;
  for (const offset of [-3, -2, -1, 0, 1, 2, 3]) {
    for (const optionType of ["CE", "PE"] as const) {
      rows.push(row({ strike: 24_500 + offset * 50, dynamicAtmOffset: offset, optionType, iv: iv++ }));
    }
  }
  const malformedOffset = rows.find((candidate) => candidate.dynamicAtmOffset === 3 && candidate.optionType === "CE")!;
  malformedOffset.dynamicAtmOffset = -3;
  const mixedExpiry = rows.find((candidate) => candidate.dynamicAtmOffset === 2 && candidate.optionType === "PE")!;
  mixedExpiry.expiry = "2026-08-25";

  const result = buildF5IvScience(rows);
  assert.equal(result.status, "PARTIAL");
  assert.equal(result.crossSection[0].eligibleContractCount, 14);
  assert.equal(result.crossSection[0].quality, "PARTIAL_VALID_SUBSET");
  assert.equal(result.crossSection[0].expiryCount, 2);
  assert.equal(result.crossSection[0].offsetSideIdentityViolationCount, 2);
  assert.equal(result.qualitySummary.universeIdentityViolationCrossSectionCount, 1);
});

test("an otherwise complete universe with a cadence gap cannot report PASS", () => {
  const rows: IvScienceInputRow[] = [];
  for (const timestamp of ["2026-08-11T09:15:00.000Z", "2026-08-11T09:17:00.000Z"]) {
    let iv = timestamp.includes("09:15") ? 10 : 11;
    for (const offset of [-3, -2, -1, 0, 1, 2, 3]) {
      for (const optionType of ["CE", "PE"] as const) {
        rows.push(row({ timestamp, strike: 24_500 + offset * 50, dynamicAtmOffset: offset, optionType, iv: iv++ }));
      }
    }
  }

  const result = buildF5IvScience(rows);
  assert.equal(result.qualitySummary.fullUniverseCrossSectionCount, 2);
  assert.equal(result.qualitySummary.cadenceGapCount, 14);
  assert.equal(result.status, "PARTIAL");
});

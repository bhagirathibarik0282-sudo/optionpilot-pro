export type IvRawQuality =
  | "VALID"
  | "MISSING"
  | "ZERO_ANOMALY"
  | "INVALID_NEGATIVE"
  | "INVALID_NON_NUMERIC"
  | "INVALID_NON_FINITE";

export type IvDerivativeQuality =
  | "VALID"
  | "UNAVAILABLE_FIRST_OBSERVATION"
  | "UNAVAILABLE_CURRENT_IV_INVALID"
  | "UNAVAILABLE_PREVIOUS_IV_INVALID"
  | "UNAVAILABLE_INVALID_CONTRACT_IDENTITY"
  | "UNAVAILABLE_INVALID_TIMESTAMP"
  | "UNAVAILABLE_DUPLICATE_TIMESTAMP"
  | "UNAVAILABLE_NON_POSITIVE_TIME_DELTA"
  | "UNAVAILABLE_CADENCE_GAP"
  | "UNAVAILABLE_PREVIOUS_VELOCITY";

export type IvCrossSectionQuality =
  | "VALID_FULL_UNIVERSE"
  | "PARTIAL_VALID_SUBSET"
  | "UNAVAILABLE_INSUFFICIENT_VALID_IV";

export type IvScienceStatus = "PASS" | "PARTIAL" | "BLOCKED";

export interface IvScienceInputRow {
  timestamp?: unknown;
  expiry?: unknown;
  strike?: unknown;
  optionType?: unknown;
  dynamicAtmOffset?: unknown;
  iv?: unknown;
  impliedVolatility?: unknown;
  implied_volatility?: unknown;
}

export interface IvScienceConfig {
  expectedCadenceMinutes?: number;
  requiredAtmOffsets?: number[];
}

export interface IvContractFeatureRow {
  timestamp: string | null;
  expiry: string | null;
  strike: number | null;
  optionType: "CE" | "PE" | null;
  dynamicAtmOffset: number | null;
  contractKey: string | null;
  ivSourceField: "iv" | "impliedVolatility" | "implied_volatility" | null;
  rawIv: unknown;
  iv: number | null;
  ivQuality: IvRawQuality;
  ivChange: number | null;
  ivChangeQuality: IvDerivativeQuality;
  ivVelocityPerMinute: number | null;
  ivVelocityQuality: IvDerivativeQuality;
  ivAccelerationPerMinute2: number | null;
  ivAccelerationQuality: IvDerivativeQuality;
}

export interface IvCrossSectionRow {
  timestamp: string;
  expectedContractCount: number;
  eligibleContractCount: number;
  validIvCount: number;
  invalidOrMissingIvCount: number;
  duplicateContractCount: number;
  ivMin: number | null;
  ivMax: number | null;
  ivRange: number | null;
  ivMean: number | null;
  ivDispersion: number | null;
  quality: IvCrossSectionQuality;
}

export interface IvScienceResult {
  status: IvScienceStatus;
  blockerCode: "NO_VALID_HISTORICAL_IV" | null;
  formulaVersion: "F5_IV_SCIENCE_v1";
  expectedCadenceMinutes: number;
  requiredAtmOffsets: number[];
  expectedContractsPerTimestamp: number;
  qualitySummary: {
    totalInputRows: number;
    requiredUniverseRows: number;
    validIvCount: number;
    missingIvCount: number;
    zeroIvAnomalyCount: number;
    negativeIvCount: number;
    nonNumericIvCount: number;
    nonFiniteIvCount: number;
    invalidContractIdentityCount: number;
    invalidTimestampCount: number;
    duplicateTimestampCount: number;
    cadenceGapCount: number;
    validIvChangeCount: number;
    validIvVelocityCount: number;
    validIvAccelerationCount: number;
    fullUniverseCrossSectionCount: number;
    partialCrossSectionCount: number;
    unavailableCrossSectionCount: number;
  };
  perContract: IvContractFeatureRow[];
  crossSection: IvCrossSectionRow[];
}

type NormalizedRow = {
  sourceIndex: number;
  timestamp: string | null;
  timestampMs: number | null;
  expiry: string | null;
  strike: number | null;
  optionType: "CE" | "PE" | null;
  dynamicAtmOffset: number | null;
  contractKey: string | null;
  ivSourceField: "iv" | "impliedVolatility" | "implied_volatility" | null;
  rawIv: unknown;
  iv: number | null;
  ivQuality: IvRawQuality;
};

const IV_FIELDS = ["iv", "impliedVolatility", "implied_volatility"] as const;

function readIv(row: IvScienceInputRow): {
  sourceField: (typeof IV_FIELDS)[number] | null;
  rawIv: unknown;
  iv: number | null;
  quality: IvRawQuality;
} {
  let sourceField: (typeof IV_FIELDS)[number] | null = null;
  for (const field of IV_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(row, field)) {
      sourceField = field;
      break;
    }
  }

  if (!sourceField) return { sourceField: null, rawIv: undefined, iv: null, quality: "MISSING" };
  const rawIv = row[sourceField];
  if (rawIv === null || rawIv === undefined) return { sourceField, rawIv, iv: null, quality: "MISSING" };
  if (typeof rawIv !== "number") return { sourceField, rawIv, iv: null, quality: "INVALID_NON_NUMERIC" };
  if (!Number.isFinite(rawIv)) return { sourceField, rawIv, iv: null, quality: "INVALID_NON_FINITE" };
  if (rawIv === 0) return { sourceField, rawIv, iv: null, quality: "ZERO_ANOMALY" };
  if (rawIv < 0) return { sourceField, rawIv, iv: null, quality: "INVALID_NEGATIVE" };
  return { sourceField, rawIv, iv: rawIv, quality: "VALID" };
}

function normalizeRow(row: IvScienceInputRow, sourceIndex: number): NormalizedRow {
  const timestamp = typeof row.timestamp === "string" && row.timestamp.trim() ? row.timestamp : null;
  const parsedTimestamp = timestamp === null ? NaN : new Date(timestamp).getTime();
  const timestampMs = Number.isFinite(parsedTimestamp) ? parsedTimestamp : null;
  const expiry = typeof row.expiry === "string" && row.expiry.trim() ? row.expiry : null;
  const strike = typeof row.strike === "number" && Number.isFinite(row.strike) ? row.strike : null;
  const rawSide = typeof row.optionType === "string" ? row.optionType.toUpperCase() : "";
  const optionType = rawSide === "CE" || rawSide === "PE" ? rawSide : null;
  const dynamicAtmOffset = typeof row.dynamicAtmOffset === "number" && Number.isFinite(row.dynamicAtmOffset)
    ? row.dynamicAtmOffset
    : null;
  const contractKey = expiry !== null && strike !== null && optionType !== null
    ? `${expiry}|${strike}|${optionType}`
    : null;
  const raw = readIv(row);
  return {
    sourceIndex,
    timestamp,
    timestampMs,
    expiry,
    strike,
    optionType,
    dynamicAtmOffset,
    contractKey,
    ivSourceField: raw.sourceField,
    rawIv: raw.rawIv,
    iv: raw.iv,
    ivQuality: raw.quality,
  };
}

function emptyFeature(row: NormalizedRow): IvContractFeatureRow {
  return {
    timestamp: row.timestamp,
    expiry: row.expiry,
    strike: row.strike,
    optionType: row.optionType,
    dynamicAtmOffset: row.dynamicAtmOffset,
    contractKey: row.contractKey,
    ivSourceField: row.ivSourceField,
    rawIv: row.rawIv,
    iv: row.iv,
    ivQuality: row.ivQuality,
    ivChange: null,
    ivChangeQuality: "UNAVAILABLE_FIRST_OBSERVATION",
    ivVelocityPerMinute: null,
    ivVelocityQuality: "UNAVAILABLE_FIRST_OBSERVATION",
    ivAccelerationPerMinute2: null,
    ivAccelerationQuality: "UNAVAILABLE_FIRST_OBSERVATION",
  };
}

function populationStdDev(values: number[], mean: number): number {
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

export function buildF5IvScience(inputRows: IvScienceInputRow[], config: IvScienceConfig = {}): IvScienceResult {
  const expectedCadenceMinutes = config.expectedCadenceMinutes ?? 1;
  if (!Number.isFinite(expectedCadenceMinutes) || expectedCadenceMinutes <= 0) {
    throw new Error("expectedCadenceMinutes must be a positive finite number");
  }
  const requiredAtmOffsets = [...new Set(config.requiredAtmOffsets ?? [-3, -2, -1, 0, 1, 2, 3])].sort((a, b) => a - b);
  if (requiredAtmOffsets.length === 0 || requiredAtmOffsets.some((value) => !Number.isFinite(value))) {
    throw new Error("requiredAtmOffsets must contain at least one finite number");
  }
  const requiredOffsetSet = new Set(requiredAtmOffsets);
  const expectedContractsPerTimestamp = requiredAtmOffsets.length * 2;

  const normalizedAll = inputRows.map(normalizeRow);
  const normalized = normalizedAll.filter((row) => row.dynamicAtmOffset !== null && requiredOffsetSet.has(row.dynamicAtmOffset));
  const featuresBySourceIndex = new Map<number, IvContractFeatureRow>();
  for (const row of normalized) featuresBySourceIndex.set(row.sourceIndex, emptyFeature(row));

  const groups = new Map<string, NormalizedRow[]>();
  for (const row of normalized) {
    if (!row.contractKey) {
      const feature = featuresBySourceIndex.get(row.sourceIndex)!;
      feature.ivChangeQuality = "UNAVAILABLE_INVALID_CONTRACT_IDENTITY";
      feature.ivVelocityQuality = "UNAVAILABLE_INVALID_CONTRACT_IDENTITY";
      feature.ivAccelerationQuality = "UNAVAILABLE_INVALID_CONTRACT_IDENTITY";
      continue;
    }
    const rows = groups.get(row.contractKey) ?? [];
    rows.push(row);
    groups.set(row.contractKey, rows);
  }

  let duplicateTimestampCount = 0;
  let cadenceGapCount = 0;

  for (const rows of groups.values()) {
    rows.sort((left, right) => {
      if (left.timestampMs === null && right.timestampMs === null) return left.sourceIndex - right.sourceIndex;
      if (left.timestampMs === null) return 1;
      if (right.timestampMs === null) return -1;
      return left.timestampMs - right.timestampMs || left.sourceIndex - right.sourceIndex;
    });

    const timestampCounts = new Map<number, number>();
    for (const row of rows) {
      if (row.timestampMs !== null) timestampCounts.set(row.timestampMs, (timestampCounts.get(row.timestampMs) ?? 0) + 1);
    }

    for (let index = 0; index < rows.length; index++) {
      const row = rows[index];
      const feature = featuresBySourceIndex.get(row.sourceIndex)!;
      const previousRow = index > 0 ? rows[index - 1] : null;
      const previousFeature = previousRow ? featuresBySourceIndex.get(previousRow.sourceIndex)! : null;

      if (row.timestampMs === null) {
        feature.ivChangeQuality = "UNAVAILABLE_INVALID_TIMESTAMP";
        feature.ivVelocityQuality = "UNAVAILABLE_INVALID_TIMESTAMP";
        feature.ivAccelerationQuality = "UNAVAILABLE_INVALID_TIMESTAMP";
        continue;
      }
      if ((timestampCounts.get(row.timestampMs) ?? 0) > 1) {
        duplicateTimestampCount++;
        feature.ivChangeQuality = "UNAVAILABLE_DUPLICATE_TIMESTAMP";
        feature.ivVelocityQuality = "UNAVAILABLE_DUPLICATE_TIMESTAMP";
        feature.ivAccelerationQuality = "UNAVAILABLE_DUPLICATE_TIMESTAMP";
        continue;
      }
      if (!previousRow) continue;
      if (row.ivQuality !== "VALID") {
        feature.ivChangeQuality = "UNAVAILABLE_CURRENT_IV_INVALID";
        feature.ivVelocityQuality = "UNAVAILABLE_CURRENT_IV_INVALID";
        feature.ivAccelerationQuality = "UNAVAILABLE_CURRENT_IV_INVALID";
        continue;
      }
      if (previousRow.ivQuality !== "VALID") {
        feature.ivChangeQuality = "UNAVAILABLE_PREVIOUS_IV_INVALID";
        feature.ivVelocityQuality = "UNAVAILABLE_PREVIOUS_IV_INVALID";
        feature.ivAccelerationQuality = "UNAVAILABLE_PREVIOUS_IV_INVALID";
        continue;
      }
      if (previousRow.timestampMs === null) {
        feature.ivChangeQuality = "UNAVAILABLE_INVALID_TIMESTAMP";
        feature.ivVelocityQuality = "UNAVAILABLE_INVALID_TIMESTAMP";
        feature.ivAccelerationQuality = "UNAVAILABLE_INVALID_TIMESTAMP";
        continue;
      }

      const deltaMinutes = (row.timestampMs - previousRow.timestampMs) / 60_000;
      if (deltaMinutes <= 0) {
        feature.ivChangeQuality = "UNAVAILABLE_NON_POSITIVE_TIME_DELTA";
        feature.ivVelocityQuality = "UNAVAILABLE_NON_POSITIVE_TIME_DELTA";
        feature.ivAccelerationQuality = "UNAVAILABLE_NON_POSITIVE_TIME_DELTA";
        continue;
      }
      if (Math.abs(deltaMinutes - expectedCadenceMinutes) > 1e-9) {
        cadenceGapCount++;
        feature.ivChangeQuality = "UNAVAILABLE_CADENCE_GAP";
        feature.ivVelocityQuality = "UNAVAILABLE_CADENCE_GAP";
        feature.ivAccelerationQuality = "UNAVAILABLE_CADENCE_GAP";
        continue;
      }

      feature.ivChange = (row.iv as number) - (previousRow.iv as number);
      feature.ivChangeQuality = "VALID";
      feature.ivVelocityPerMinute = feature.ivChange / deltaMinutes;
      feature.ivVelocityQuality = "VALID";

      if (previousFeature?.ivVelocityQuality === "VALID" && previousFeature.ivVelocityPerMinute !== null) {
        feature.ivAccelerationPerMinute2 = (feature.ivVelocityPerMinute - previousFeature.ivVelocityPerMinute) / deltaMinutes;
        feature.ivAccelerationQuality = "VALID";
      } else {
        feature.ivAccelerationQuality = "UNAVAILABLE_PREVIOUS_VELOCITY";
      }
    }
  }

  const perContract = normalized
    .map((row) => featuresBySourceIndex.get(row.sourceIndex)!)
    .sort((left, right) =>
      (left.timestamp ?? "").localeCompare(right.timestamp ?? "") ||
      (left.strike ?? Number.POSITIVE_INFINITY) - (right.strike ?? Number.POSITIVE_INFINITY) ||
      (left.optionType ?? "").localeCompare(right.optionType ?? "")
    );

  const rowsByTimestamp = new Map<string, NormalizedRow[]>();
  for (const row of normalized) {
    if (row.timestamp === null || row.timestampMs === null) continue;
    const rows = rowsByTimestamp.get(row.timestamp) ?? [];
    rows.push(row);
    rowsByTimestamp.set(row.timestamp, rows);
  }

  const crossSection: IvCrossSectionRow[] = [];
  for (const [timestamp, rows] of [...rowsByTimestamp.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const countsByContract = new Map<string, number>();
    for (const row of rows) {
      if (row.contractKey) countsByContract.set(row.contractKey, (countsByContract.get(row.contractKey) ?? 0) + 1);
    }
    const duplicateContracts = new Set(
      [...countsByContract.entries()].filter(([, count]) => count > 1).map(([contractKey]) => contractKey)
    );
    const uniqueEligible = rows.filter((row) => row.contractKey !== null && !duplicateContracts.has(row.contractKey));
    const validValues = uniqueEligible.filter((row) => row.ivQuality === "VALID").map((row) => row.iv as number);
    const validIvCount = validValues.length;
    const eligibleContractCount = uniqueEligible.length;
    const duplicateContractCount = duplicateContracts.size;
    const invalidOrMissingIvCount = eligibleContractCount - validIvCount;

    let ivMin: number | null = null;
    let ivMax: number | null = null;
    let ivRange: number | null = null;
    let ivMean: number | null = null;
    let ivDispersion: number | null = null;
    let quality: IvCrossSectionQuality = "UNAVAILABLE_INSUFFICIENT_VALID_IV";

    if (validValues.length >= 2) {
      ivMin = Math.min(...validValues);
      ivMax = Math.max(...validValues);
      ivRange = ivMax - ivMin;
      ivMean = validValues.reduce((sum, value) => sum + value, 0) / validValues.length;
      ivDispersion = populationStdDev(validValues, ivMean);
      quality = validIvCount === expectedContractsPerTimestamp && eligibleContractCount === expectedContractsPerTimestamp && duplicateContractCount === 0
        ? "VALID_FULL_UNIVERSE"
        : "PARTIAL_VALID_SUBSET";
    }

    crossSection.push({
      timestamp,
      expectedContractCount: expectedContractsPerTimestamp,
      eligibleContractCount,
      validIvCount,
      invalidOrMissingIvCount,
      duplicateContractCount,
      ivMin,
      ivMax,
      ivRange,
      ivMean,
      ivDispersion,
      quality,
    });
  }

  const countRawQuality = (quality: IvRawQuality) => perContract.filter((row) => row.ivQuality === quality).length;
  const validIvCount = countRawQuality("VALID");
  const fullUniverseCrossSectionCount = crossSection.filter((row) => row.quality === "VALID_FULL_UNIVERSE").length;
  const partialCrossSectionCount = crossSection.filter((row) => row.quality === "PARTIAL_VALID_SUBSET").length;
  const unavailableCrossSectionCount = crossSection.filter((row) => row.quality === "UNAVAILABLE_INSUFFICIENT_VALID_IV").length;
  const invalidContractIdentityCount = perContract.filter((row) => row.contractKey === null).length;
  const invalidTimestampCount = perContract.filter((row) => row.timestamp === null || !Number.isFinite(new Date(row.timestamp).getTime())).length;
  const allRowsValid = validIvCount === perContract.length && invalidContractIdentityCount === 0 && invalidTimestampCount === 0 && duplicateTimestampCount === 0;
  const allCrossSectionsFull = crossSection.length > 0 && fullUniverseCrossSectionCount === crossSection.length;
  const status: IvScienceStatus = validIvCount === 0 ? "BLOCKED" : (allRowsValid && allCrossSectionsFull ? "PASS" : "PARTIAL");

  return {
    status,
    blockerCode: status === "BLOCKED" ? "NO_VALID_HISTORICAL_IV" : null,
    formulaVersion: "F5_IV_SCIENCE_v1",
    expectedCadenceMinutes,
    requiredAtmOffsets,
    expectedContractsPerTimestamp,
    qualitySummary: {
      totalInputRows: inputRows.length,
      requiredUniverseRows: perContract.length,
      validIvCount,
      missingIvCount: countRawQuality("MISSING"),
      zeroIvAnomalyCount: countRawQuality("ZERO_ANOMALY"),
      negativeIvCount: countRawQuality("INVALID_NEGATIVE"),
      nonNumericIvCount: countRawQuality("INVALID_NON_NUMERIC"),
      nonFiniteIvCount: countRawQuality("INVALID_NON_FINITE"),
      invalidContractIdentityCount,
      invalidTimestampCount,
      duplicateTimestampCount,
      cadenceGapCount,
      validIvChangeCount: perContract.filter((row) => row.ivChangeQuality === "VALID").length,
      validIvVelocityCount: perContract.filter((row) => row.ivVelocityQuality === "VALID").length,
      validIvAccelerationCount: perContract.filter((row) => row.ivAccelerationQuality === "VALID").length,
      fullUniverseCrossSectionCount,
      partialCrossSectionCount,
      unavailableCrossSectionCount,
    },
    perContract,
    crossSection,
  };
}

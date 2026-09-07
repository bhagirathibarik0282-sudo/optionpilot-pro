export interface H1DeltaThresholdStabilityInput {
  calibrationP95: number | null;
  oosP95: number | null;
  oosPassRateAtCandidate: number | null;
  minRelativeRetention?: number;
  minOosPassRate?: number;
}

export function evaluateH1DeltaThresholdStability(input: H1DeltaThresholdStabilityInput) {
  const blockers:string[]=[];
  const minRelativeRetention=input.minRelativeRetention ?? 0.70;
  const minOosPassRate=input.minOosPassRate ?? 0.03;
  if(input.calibrationP95==null||!Number.isFinite(input.calibrationP95)||input.calibrationP95<=0) blockers.push("CALIBRATION_P95_REQUIRED");
  if(input.oosP95==null||!Number.isFinite(input.oosP95)||input.oosP95<=0) blockers.push("OOS_P95_REQUIRED");
  if(input.oosPassRateAtCandidate==null||!Number.isFinite(input.oosPassRateAtCandidate)||input.oosPassRateAtCandidate<0) blockers.push("OOS_PASS_RATE_REQUIRED");
  const retention=blockers.length?null:input.oosP95!/input.calibrationP95!;
  if(retention!=null && retention<minRelativeRetention) blockers.push("P95_RETENTION_TOO_LOW");
  if(input.oosPassRateAtCandidate!=null && input.oosPassRateAtCandidate<minOosPassRate) blockers.push("OOS_PASS_RATE_TOO_LOW");
  return {
    version:"H1_DELTA_THRESHOLD_STABILITY_V1",
    semantics:"HISTORICAL_RESEARCH_ONLY",
    stable:blockers.length===0,
    calibrationP95:input.calibrationP95,
    oosP95:input.oosP95,
    p95RetentionRatio:retention,
    oosPassRateAtCandidate:input.oosPassRateAtCandidate,
    thresholds:{minRelativeRetention,minOosPassRate},
    blockers,
    productionImpact:"NONE",
    affectsSelector:false,
    affectsTelegram:false,
    affectsExecution:false,
    failClosed:true,
  } as const;
}

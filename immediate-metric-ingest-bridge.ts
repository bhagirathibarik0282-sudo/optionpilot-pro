import { ImmediateAbnormalChangeDetector, type ImmediateMetricSample } from "./immediate-abnormal-change-detector.js";
import { ImmediateEventTruthRecorder, type ImmediateTruthAppendResult } from "./immediate-event-truth-recorder.js";
import type { RecorderSymbol } from "./option-recorder-shadow.js";

export type ImmediateMetricIngestInput = {
  symbol: RecorderSymbol;
  lockedTrendSide: "CE" | "PE" | "NONE";
  fresh?: boolean;
  sample: ImmediateMetricSample;
};

export type ImmediateMetricIngestResult = {
  version: "IMMEDIATE_METRIC_INGEST_BRIDGE_V1";
  semantics: "RESEARCH_SHADOW_ONLY";
  symbol: RecorderSymbol;
  detector: ReturnType<ImmediateAbnormalChangeDetector["observe"]>;
  truthRecord: ImmediateTruthAppendResult | null;
  affectsVerdict: false;
  affectsExecution: false;
  affectsTelegram: false;
};

export class ImmediateMetricIngestBridge {
  private readonly detectors = new Map<string, ImmediateAbnormalChangeDetector>();

  constructor(private readonly truthRecorder: ImmediateEventTruthRecorder) {}

  ingest(input: ImmediateMetricIngestInput): ImmediateMetricIngestResult {
    if (!input || !input.sample) throw new Error("INVALID_IMMEDIATE_METRIC_INGEST");
    const key = [input.symbol, input.sample.source, input.sample.family, input.sample.factLabel].join("|");
    let detector = this.detectors.get(key);
    if (!detector) {
      detector = new ImmediateAbnormalChangeDetector();
      this.detectors.set(key, detector);
    }

    const result = detector.observe(input.sample, input.lockedTrendSide, input.fresh !== false);
    let truthRecord: ImmediateTruthAppendResult | null = null;

    if (result.event) {
      truthRecord = this.truthRecorder.append({
        symbol: input.symbol,
        source: input.sample.source,
        snapshotId: input.sample.snapshotId ?? null,
        receivedAt: new Date().toISOString(),
        event: result.event,
      });
    }

    return {
      version: "IMMEDIATE_METRIC_INGEST_BRIDGE_V1",
      semantics: "RESEARCH_SHADOW_ONLY",
      symbol: input.symbol,
      detector: result,
      truthRecord,
      affectsVerdict: false,
      affectsExecution: false,
      affectsTelegram: false,
    };
  }

  stats() {
    return {
      version: "IMMEDIATE_METRIC_INGEST_BRIDGE_V1" as const,
      detectorStreams: this.detectors.size,
      semantics: "RESEARCH_SHADOW_ONLY" as const,
    };
  }
}

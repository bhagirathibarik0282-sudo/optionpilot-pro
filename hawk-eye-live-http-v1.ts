import type { Hono } from "hono";
import { buildHawkEyeRuntimeShadowV1, type HawkEyeRuntimeShadowInput } from "./hawk-eye-runtime-shadow-v1.js";

type Source = Pick<HawkEyeRuntimeShadowInput, "registry" | "constituentMinutes">;

export function mountHawkEyeLiveRoute(app: Hono, readSource: () => Source | null, clock = Date.now): void {
  app.get("/api/research/hawk-eye-live-shadow", c => {
    c.header("Cache-Control", "no-store");
    const safety = {
      mode: "READ_ONLY_HAWK_EYE_LIVE_SHADOW_V1", productionImpact: "NONE", readOnly: true,
      affectsSelector: false, affectsVerdict: false, affectsTelegram: false,
      affectsExecution: false, createsOrders: false, probability: null,
      candidate: null, calibratedEdgeProven: false, bankniftyContextOnly: true,
      persistence: "BOUNDED_PROCESS_MEMORY_30_CLOSED_MINUTES", survivesRestart: false,
    };
    try {
      const source = readSource();
      const asOfMs = clock();
      if (!source?.registry.length) return c.json({ ...safety, ok: true, state: "BLOCKED",
        blocker: "LIVE_CONSTITUENT_REGISTRY_NOT_AVAILABLE", asOfMs, report: null });
      const report = buildHawkEyeRuntimeShadowV1({ ...source, asOfMs });
      const hasFeatures = report.observation.features.length > 0;
      return c.json({ ...safety, ok: true, state: hasFeatures ? "PARTIAL" : "NOT_PROVEN",
        blocker: hasFeatures ? null : report.inputClosedMinuteCount === 0
          ? "CLOSED_MINUTE_HISTORY_WARMING" : "FRESH_WINDOW_FEATURES_NOT_READY",
        asOfMs, registryEntryCount: source.registry.length, report,
        pending: ["SISTER_SNAPSHOT_ATTACHMENT", "HISTORICAL_IMPACT_CALIBRATION_RUN", "BUSINESS_EDGE_VALIDATION"],
      });
    } catch {
      return c.json({ ...safety, ok: false, state: "BLOCKED", blocker: "HAWK_EYE_SOURCE_READ_FAILED", report: null }, 503);
    }
  });
}

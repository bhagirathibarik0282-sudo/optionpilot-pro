import { getFiiDiiProductionReadiness } from "./canonical-fii-dii-production-readiness.js";

export async function runFiiDiiProductionReadinessHttp(
  runner: typeof getFiiDiiProductionReadiness = getFiiDiiProductionReadiness,
): Promise<{ status: 200 | 503; body: Record<string, unknown> }> {
  try {
    const result = await runner();
    return {
      status: result.ready ? 200 : 503,
      body: {
        ok: result.ready,
        mode: "READ_ONLY_FII_DII_PRODUCTION_READINESS_V1",
        productionImpact: "NONE",
        ...result,
      },
    };
  } catch (err) {
    return {
      status: 503,
      body: {
        ok: false,
        mode: "READ_ONLY_FII_DII_PRODUCTION_READINESS_V1",
        productionImpact: "NONE",
        ready: false,
        reason: err instanceof Error ? err.message : "FII_DII_PRODUCTION_READINESS_FAILED",
        readOnly: true,
        contextOnly: true,
        affectsVerdict: false,
        affectsCandidate: false,
        affectsTelegram: false,
        affectsExecution: false,
        failClosed: true,
      },
    };
  }
}

import {
  classifyH1DteShadowBucket,
  type H1DteShadowBucket,
} from "./h1-dte-aware-shadow-threshold-v1.js";
import type { ThetaIvMultiExpiryPolicy } from "./h1-live-theta-iv-multi-expiry-evaluator.js";

export interface H1ShadowDteBurdenOverride {
  maxAbsThetaPctOfPremium: number;
  minIv: number;
  maxIv: number;
}

export type H1ShadowDteBurdenOverrides = Partial<
  Record<H1DteShadowBucket, H1ShadowDteBurdenOverride>
>;

const ALLOWED_BUCKETS: H1DteShadowBucket[] = [
  "EXPIRY_0_1",
  "NEAR_2_4",
  "MID_5_9",
  "FAR_10_PLUS",
];

function validOverride(value: unknown): value is H1ShadowDteBurdenOverride {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const x = value as H1ShadowDteBurdenOverride;
  return Number.isFinite(x.maxAbsThetaPctOfPremium) && x.maxAbsThetaPctOfPremium >= 0
    && Number.isFinite(x.minIv) && x.minIv >= 0
    && Number.isFinite(x.maxIv) && x.maxIv >= x.minIv;
}

export function parseH1ShadowDteBurdenOverrides(raw: unknown): H1ShadowDteBurdenOverrides {
  if (raw == null) return {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("KITE_H1_SHADOW_DTE_BURDEN_OVERRIDES_INVALID");
  }

  const input = raw as Record<string, unknown>;
  for (const key of Object.keys(input)) {
    if (!(ALLOWED_BUCKETS as readonly string[]).includes(key)) {
      throw new Error("KITE_H1_SHADOW_DTE_BURDEN_OVERRIDE_BUCKET_INVALID");
    }
    if (!validOverride(input[key])) {
      throw new Error("KITE_H1_SHADOW_DTE_BURDEN_OVERRIDE_INVALID");
    }
  }
  return structuredClone(input) as H1ShadowDteBurdenOverrides;
}

export function resolveH1ShadowDteBurdenPolicy(
  dte: number,
  base: ThetaIvMultiExpiryPolicy,
  overrides: H1ShadowDteBurdenOverrides,
): {
  version: "H1_SHADOW_DTE_BURDEN_POLICY_V1";
  bucket: H1DteShadowBucket;
  policy: ThetaIvMultiExpiryPolicy;
  source: "GLOBAL_BASE" | "SHADOW_DTE_OVERRIDE";
  productionImpact: "NONE";
  affectsSelector: false;
  affectsBusinessCard: false;
  affectsTelegram: false;
  affectsExecution: false;
  failClosed: true;
} {
  const bucket = classifyH1DteShadowBucket(dte);
  const override = overrides[bucket];

  return {
    version: "H1_SHADOW_DTE_BURDEN_POLICY_V1",
    bucket,
    policy: override ? {
      ...base,
      maxAbsThetaPctOfPremium: override.maxAbsThetaPctOfPremium,
      minIv: override.minIv,
      maxIv: override.maxIv,
    } : { ...base },
    source: override ? "SHADOW_DTE_OVERRIDE" : "GLOBAL_BASE",
    productionImpact: "NONE",
    affectsSelector: false,
    affectsBusinessCard: false,
    affectsTelegram: false,
    affectsExecution: false,
    failClosed: true,
  };
}

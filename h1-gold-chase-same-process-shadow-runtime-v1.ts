import {
  auditH1GoldChaseRuntimeAttachment,
  type H1GoldChaseRuntimeAttachmentGateInput,
  type H1GoldChaseRuntimeAttachmentGateResult,
} from "./h1-gold-chase-runtime-attachment-gate-v1.js";
import {
  H1GoldChaseShadowRuntimeCollector,
  type H1GoldChaseShadowRuntimeEvent,
  type H1GoldChaseShadowRuntimeTickResult,
} from "./h1-gold-chase-shadow-runtime-collector-v1.js";

export const H1_GOLD_CHASE_SAME_PROCESS_SHADOW_RUNTIME_V1 = "H1_GOLD_CHASE_SAME_PROCESS_SHADOW_RUNTIME_V1" as const;

export type H1GoldChaseSameProcessAttachInput = Omit<
  H1GoldChaseRuntimeAttachmentGateInput,
  "registryProcessIdentity" | "collectorProcessIdentity"
>;

export interface H1GoldChaseSameProcessAttachResult {
  version: typeof H1_GOLD_CHASE_SAME_PROCESS_SHADOW_RUNTIME_V1;
  state: "ATTACHED" | "BLOCKED";
  ready: boolean;
  gate: H1GoldChaseRuntimeAttachmentGateResult;
  registration: H1GoldChaseShadowRuntimeEvent | null;
  blockers: string[];
  productionImpact: "NONE";
  affectsGoldEligibility: false;
  affectsSelector: false;
  affectsTelegram: false;
  affectsExecution: false;
  grantsPromotionAuthority: false;
  createsOrders: false;
  failClosed: true;
  semantics: "SAME_PROCESS_GOLD_CHASE_SHADOW_ATTACHMENT_ONLY_NO_PRODUCTION_AUTHORITY";
}

type Audit = (input: H1GoldChaseRuntimeAttachmentGateInput) => H1GoldChaseRuntimeAttachmentGateResult;
type Collector = Pick<H1GoldChaseShadowRuntimeCollector, "register" | "tick" | "activeSessionCount">;

export interface H1GoldChaseSameProcessShadowRuntimeDeps {
  audit?: Audit;
  collector?: Collector;
}

const SAFETY = Object.freeze({
  productionImpact: "NONE" as const,
  affectsGoldEligibility: false as const,
  affectsSelector: false as const,
  affectsTelegram: false as const,
  affectsExecution: false as const,
  grantsPromotionAuthority: false as const,
  createsOrders: false as const,
  failClosed: true as const,
  semantics: "SAME_PROCESS_GOLD_CHASE_SHADOW_ATTACHMENT_ONLY_NO_PRODUCTION_AUTHORITY" as const,
});

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

/**
 * Minimal same-process seam between the already-approved attachment gate and
 * the bounded shadow collector. It deliberately accepts pre-built canonical,
 * Gold-bridge and bootstrap inputs instead of deriving or inferring them.
 *
 * This class does not own sockets, timers, selector state, Telegram transport,
 * execution or production Gold authority. Callers must invoke tick from the
 * registry-owning process. Gate failure prevents collector registration.
 */
export class H1GoldChaseSameProcessShadowRuntime {
  private readonly processIdentity: string;
  private readonly audit: Audit;
  private readonly collector: Collector;

  constructor(processIdentity: string, deps: H1GoldChaseSameProcessShadowRuntimeDeps = {}) {
    this.processIdentity = processIdentity.trim();
    this.audit = deps.audit ?? auditH1GoldChaseRuntimeAttachment;
    this.collector = deps.collector ?? new H1GoldChaseShadowRuntimeCollector();
  }

  attach(input: H1GoldChaseSameProcessAttachInput): H1GoldChaseSameProcessAttachResult {
    const gate = this.audit({
      ...input,
      registryProcessIdentity: this.processIdentity,
      collectorProcessIdentity: this.processIdentity,
    });

    if (!this.processIdentity || !gate.ready || gate.state !== "READY_FOR_SAME_PROCESS_SHADOW_ATTACHMENT" || !input.bootstrap) {
      const blockers = unique([
        ...gate.blockers,
        ...(!this.processIdentity ? ["RUNTIME_PROCESS_IDENTITY_REQUIRED"] : []),
        ...(!input.bootstrap ? ["SAFE_RESEARCH_BOOTSTRAP_NOT_READY"] : []),
      ]);
      return {
        version: H1_GOLD_CHASE_SAME_PROCESS_SHADOW_RUNTIME_V1,
        state: "BLOCKED",
        ready: false,
        gate,
        registration: null,
        blockers,
        ...SAFETY,
      };
    }

    const registration = this.collector.register(input.bootstrap);
    const ready = registration.state === "REGISTERED";
    return {
      version: H1_GOLD_CHASE_SAME_PROCESS_SHADOW_RUNTIME_V1,
      state: ready ? "ATTACHED" : "BLOCKED",
      ready,
      gate,
      registration,
      blockers: ready ? registration.blockers : unique(["SHADOW_COLLECTOR_REGISTRATION_REJECTED", ...registration.blockers]),
      ...SAFETY,
    };
  }

  tick(nowIso: string): Promise<H1GoldChaseShadowRuntimeTickResult> {
    return this.collector.tick(nowIso);
  }

  activeSessionCount(): number {
    return this.collector.activeSessionCount();
  }
}

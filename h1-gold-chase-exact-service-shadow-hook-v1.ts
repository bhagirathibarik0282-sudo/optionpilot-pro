import type { KiteH1ExactDualPathResult } from "./kite-h1-exact-dual-path-core.js";
import type { LiveGateEvidencePacket } from "./h1-live-gate-evidence-assembler.js";
import {
  H1GoldChaseSameProcessShadowRuntime,
  type H1GoldChaseSameProcessAttachInput,
  type H1GoldChaseSameProcessAttachResult,
} from "./h1-gold-chase-same-process-shadow-runtime-v1.js";
import type { H1GoldChaseShadowRuntimeTickResult } from "./h1-gold-chase-shadow-runtime-collector-v1.js";

export const H1_GOLD_CHASE_EXACT_SERVICE_SHADOW_HOOK_V1 =
  "H1_GOLD_CHASE_EXACT_SERVICE_SHADOW_HOOK_V1" as const;

export type H1GoldChaseExactServiceShadowHookState =
  | "DISABLED"
  | "BLOCKED"
  | "ATTACHED_AND_TICKED";

export interface H1GoldChaseExactServiceLineageRequest {
  packet: LiveGateEvidencePacket;
  dualPath: KiteH1ExactDualPathResult;
  observedAt: string;
}

export type H1GoldChaseExactServiceLineageResolver = (
  request: H1GoldChaseExactServiceLineageRequest,
) => H1GoldChaseSameProcessAttachInput | null | Promise<H1GoldChaseSameProcessAttachInput | null>;

export interface H1GoldChaseExactServiceShadowHookStatus {
  version: typeof H1_GOLD_CHASE_EXACT_SERVICE_SHADOW_HOOK_V1;
  state: H1GoldChaseExactServiceShadowHookState;
  enabled: boolean;
  observedAt: string | null;
  candidateKey: string | null;
  activeSessionCount: number;
  attachment: H1GoldChaseSameProcessAttachResult | null;
  tick: H1GoldChaseShadowRuntimeTickResult | null;
  blockers: string[];
  ownsTimer: false;
  productionImpact: "NONE";
  affectsGoldEligibility: false;
  affectsSelector: false;
  affectsTelegram: false;
  affectsExecution: false;
  grantsPromotionAuthority: false;
  createsOrders: false;
  failClosed: true;
  semantics: "DEFAULT_OFF_SAME_PROCESS_EXACT_PACKET_HOOK_REQUIRES_VERIFIED_GOLD_LINEAGE";
}

type Runtime = Pick<
  H1GoldChaseSameProcessShadowRuntime,
  "attach" | "tick" | "activeSessionCount"
>;

export interface H1GoldChaseExactServiceShadowHookDeps {
  enabled: boolean;
  resolver?: H1GoldChaseExactServiceLineageResolver;
  runtime?: Runtime;
}

const SAFETY = Object.freeze({
  ownsTimer: false as const,
  productionImpact: "NONE" as const,
  affectsGoldEligibility: false as const,
  affectsSelector: false as const,
  affectsTelegram: false as const,
  affectsExecution: false as const,
  grantsPromotionAuthority: false as const,
  createsOrders: false as const,
  failClosed: true as const,
  semantics: "DEFAULT_OFF_SAME_PROCESS_EXACT_PACKET_HOOK_REQUIRES_VERIFIED_GOLD_LINEAGE" as const,
});

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function candidateKey(packet: LiveGateEvidencePacket | null): string | null {
  const identity = packet?.identity;
  if (!identity || (identity.symbol !== "NIFTY" && identity.symbol !== "SENSEX")) return null;
  if ((identity.side !== "CE" && identity.side !== "PE") || !identity.expiryDate || !Number.isFinite(identity.strike)) return null;
  return identity.symbol + "|" + identity.expiryDate + "|" + identity.strike + "|" + identity.side;
}

function exactPacketFrom(result: KiteH1ExactDualPathResult): LiveGateEvidencePacket | null {
  if (
    result?.version !== "KITE_H1_EXACT_DUAL_PATH_CORE_V1"
    || result.processed !== true
    || result.exactReady !== true
    || result.exact?.action !== "OPTION_EVALUATED"
    || result.exact.bridge?.ready !== true
  ) return null;
  return result.exact.bridge.publisher?.producer?.packet ?? null;
}

function status(
  state: H1GoldChaseExactServiceShadowHookState,
  enabled: boolean,
  observedAt: string | null,
  packet: LiveGateEvidencePacket | null,
  activeSessionCount: number,
  attachment: H1GoldChaseSameProcessAttachResult | null,
  tick: H1GoldChaseShadowRuntimeTickResult | null,
  blockers: string[],
): H1GoldChaseExactServiceShadowHookStatus {
  return {
    version: H1_GOLD_CHASE_EXACT_SERVICE_SHADOW_HOOK_V1,
    state,
    enabled,
    observedAt,
    candidateKey: candidateKey(packet),
    activeSessionCount,
    attachment,
    tick,
    blockers: unique(blockers),
    ...SAFETY,
  };
}

/**
 * Default-OFF hook inside the registry-owning exact service process.
 *
 * It accepts only the exact packet produced by that same ingest call. Canonical
 * runtime, approved Gold bridge and research bootstrap must be supplied by an
 * explicit verified-lineage resolver; this hook never fabricates them. It owns
 * no timer and gains no selector, Telegram, execution, order or promotion
 * authority.
 */
export class H1GoldChaseExactServiceShadowHook {
  private readonly enabled: boolean;
  private readonly resolver?: H1GoldChaseExactServiceLineageResolver;
  private readonly runtime: Runtime;
  private latest: H1GoldChaseExactServiceShadowHookStatus;

  constructor(deps: H1GoldChaseExactServiceShadowHookDeps) {
    this.enabled = deps.enabled === true;
    this.resolver = deps.resolver;
    this.runtime = deps.runtime ?? new H1GoldChaseSameProcessShadowRuntime("h1-exact-shadow-live-service");
    this.latest = status(
      this.enabled ? "BLOCKED" : "DISABLED",
      this.enabled,
      null,
      null,
      0,
      null,
      null,
      this.enabled && !this.resolver ? ["VERIFIED_GOLD_LINEAGE_RESOLVER_REQUIRED"] : [],
    );
  }

  latestStatus(): H1GoldChaseExactServiceShadowHookStatus {
    return { ...this.latest, blockers: [...this.latest.blockers] };
  }

  async observe(
    dualPath: KiteH1ExactDualPathResult,
    observedAt: string,
  ): Promise<H1GoldChaseExactServiceShadowHookStatus> {
    if (!this.enabled) {
      this.latest = status("DISABLED", false, observedAt, null, 0, null, null, []);
      return this.latestStatus();
    }

    const packet = exactPacketFrom(dualPath);
    if (!packet) {
      this.latest = status(
        "BLOCKED", true, observedAt, null, this.runtime.activeSessionCount(), null, null,
        ["EXACT_LIVE_GATE_PACKET_NOT_READY"],
      );
      return this.latestStatus();
    }

    if (!this.resolver) {
      this.latest = status(
        "BLOCKED", true, observedAt, packet, this.runtime.activeSessionCount(), null, null,
        ["VERIFIED_GOLD_LINEAGE_RESOLVER_REQUIRED"],
      );
      return this.latestStatus();
    }

    let input: H1GoldChaseSameProcessAttachInput | null;
    try {
      input = await this.resolver({ packet, dualPath, observedAt });
    } catch {
      input = null;
    }
    if (!input) {
      this.latest = status(
        "BLOCKED", true, observedAt, packet, this.runtime.activeSessionCount(), null, null,
        ["VERIFIED_GOLD_LINEAGE_NOT_READY"],
      );
      return this.latestStatus();
    }
    if (input.packet !== packet) {
      this.latest = status(
        "BLOCKED", true, observedAt, packet, this.runtime.activeSessionCount(), null, null,
        ["RESOLVER_PACKET_NOT_SAME_INGEST_OBJECT"],
      );
      return this.latestStatus();
    }

    let attachment: H1GoldChaseSameProcessAttachResult;
    try {
      attachment = this.runtime.attach(input);
    } catch {
      this.latest = status(
        "BLOCKED", true, observedAt, packet, this.runtime.activeSessionCount(), null, null,
        ["ATTACHMENT_RUNTIME_EXCEPTION"],
      );
      return this.latestStatus();
    }
    if (!attachment.ready || attachment.state !== "ATTACHED") {
      this.latest = status(
        "BLOCKED", true, observedAt, packet, this.runtime.activeSessionCount(), attachment, null,
        attachment.blockers,
      );
      return this.latestStatus();
    }

    let tick: H1GoldChaseShadowRuntimeTickResult;
    try {
      tick = await this.runtime.tick(observedAt);
    } catch {
      this.latest = status(
        "BLOCKED", true, observedAt, packet, this.runtime.activeSessionCount(), attachment, null,
        ["SHADOW_TICK_RUNTIME_EXCEPTION"],
      );
      return this.latestStatus();
    }
    const tickBlocked = tick.events.some((event) =>
      event.state === "REJECTED" || event.state === "DROPPED_FAIL_CLOSED"
    );
    this.latest = status(
      tickBlocked ? "BLOCKED" : "ATTACHED_AND_TICKED",
      true,
      observedAt,
      packet,
      tick.activeSessionCount,
      attachment,
      tick,
      tickBlocked ? tick.events.flatMap((event) => event.blockers) : [],
    );
    return this.latestStatus();
  }
}

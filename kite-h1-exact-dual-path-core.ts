import {
  H1KiteExactRuntimeCoordinator,
  type H1KiteExactRuntimeCoordinatorConfig,
  type H1KiteExactRuntimeCoordinatorResult,
} from "./h1-kite-exact-runtime-coordinator.js";
import {
  KiteImmediateRuntimeCore,
  type KiteImmediateRuntimeCoreConfig,
  type KiteImmediateRuntimePacketResult,
} from "./kite-immediate-runtime-core.js";
import type { KiteDecodedPacket } from "./kite-websocket-binary-decoder.js";

export interface KiteImmediatePacketPath {
  ingestPacket(packet: KiteDecodedPacket, receivedAt: string): Promise<KiteImmediateRuntimePacketResult>;
}

export interface KiteH1ExactPacketPath {
  ingest(packet: KiteDecodedPacket, receivedAt: string, nowIso?: string): H1KiteExactRuntimeCoordinatorResult;
}

export interface KiteH1ExactDualPathResult {
  version: "KITE_H1_EXACT_DUAL_PATH_CORE_V1";
  instrumentToken: number;
  processed: boolean;
  exactReady: boolean;
  immediate: KiteImmediateRuntimePacketResult | null;
  exact: H1KiteExactRuntimeCoordinatorResult | null;
  blockers: Array<"IMMEDIATE_PATH_EXCEPTION" | "H1_EXACT_PATH_EXCEPTION">;
  productionImpact: "NONE";
  affectsTelegram: false;
  affectsVerdict: false;
  affectsExecution: false;
  failClosed: true;
}

/**
 * Fans one decoded FULL packet into the existing immediate research path and
 * the exact H1 path concurrently. A failure in either path is contained and
 * reported without granting authority or suppressing the other path's result.
 */
export class KiteH1ExactDualPathCore {
  constructor(
    private readonly immediatePath: KiteImmediatePacketPath,
    private readonly exactPath: KiteH1ExactPacketPath,
  ) {}

  async ingestPacket(
    packet: KiteDecodedPacket,
    receivedAt: string,
    nowIso: string = receivedAt,
  ): Promise<KiteH1ExactDualPathResult> {
    const [immediateSettled, exactSettled] = await Promise.allSettled([
      this.immediatePath.ingestPacket(packet, receivedAt),
      Promise.resolve().then(() => this.exactPath.ingest(packet, receivedAt, nowIso)),
    ]);

    const blockers: KiteH1ExactDualPathResult["blockers"] = [];
    const immediate = immediateSettled.status === "fulfilled" ? immediateSettled.value : null;
    const exact = exactSettled.status === "fulfilled" ? exactSettled.value : null;
    if (immediateSettled.status === "rejected") blockers.push("IMMEDIATE_PATH_EXCEPTION");
    if (exactSettled.status === "rejected") blockers.push("H1_EXACT_PATH_EXCEPTION");

    return {
      version: "KITE_H1_EXACT_DUAL_PATH_CORE_V1",
      instrumentToken: packet?.instrumentToken ?? 0,
      processed: blockers.length === 0,
      exactReady: blockers.length === 0 && exact?.ready === true,
      immediate,
      exact,
      blockers,
      productionImpact: "NONE",
      affectsTelegram: false,
      affectsVerdict: false,
      affectsExecution: false,
      failClosed: true,
    };
  }
}

export function createKiteH1ExactDualPathCore(
  immediateConfig: KiteImmediateRuntimeCoreConfig,
  exactConfig: H1KiteExactRuntimeCoordinatorConfig,
): KiteH1ExactDualPathCore {
  return new KiteH1ExactDualPathCore(
    new KiteImmediateRuntimeCore(immediateConfig),
    new H1KiteExactRuntimeCoordinator(exactConfig),
  );
}

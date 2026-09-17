import type { H1GoldChasePremiumPoint } from "./h1-gold-chase-observation-v1.js";
import type { LiveGateEvidencePacket } from "./h1-live-gate-evidence-assembler.js";

export const H1_GOLD_CHASE_EXACT_PREMIUM_PATH_STORE_V1 =
  "H1_GOLD_CHASE_EXACT_PREMIUM_PATH_STORE_V1" as const;

export interface H1GoldChaseExactPremiumPathRecordResult {
  version: typeof H1_GOLD_CHASE_EXACT_PREMIUM_PATH_STORE_V1;
  state: "RECORDED" | "IGNORED_DUPLICATE" | "BLOCKED";
  ready: boolean;
  candidateKey: string | null;
  pointCount: number;
  blockers: string[];
  productionImpact: "NONE";
  affectsGoldEligibility: false;
  affectsSelector: false;
  affectsTelegram: false;
  affectsExecution: false;
  grantsPromotionAuthority: false;
  createsOrders: false;
  calculatesThresholds: false;
  failClosed: true;
}

export interface H1GoldChaseExactPremiumPathResult {
  version: typeof H1_GOLD_CHASE_EXACT_PREMIUM_PATH_STORE_V1;
  ready: boolean;
  candidateKey: string | null;
  points: H1GoldChasePremiumPoint[];
  blockers: string[];
  productionImpact: "NONE";
  failClosed: true;
}

const SAFETY = Object.freeze({
  productionImpact: "NONE" as const,
  affectsGoldEligibility: false as const,
  affectsSelector: false as const,
  affectsTelegram: false as const,
  affectsExecution: false as const,
  grantsPromotionAuthority: false as const,
  createsOrders: false as const,
  calculatesThresholds: false as const,
  failClosed: true as const,
});

function tradingDateIst(timestampMs: number): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(timestampMs));
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function candidateKey(packet: LiveGateEvidencePacket): string | null {
  const id = packet?.identity;
  if (!id || (id.symbol !== "NIFTY" && id.symbol !== "SENSEX")) return null;
  if ((id.side !== "CE" && id.side !== "PE") || !id.expiryDate || !Number.isFinite(id.strike) || id.strike <= 0) return null;
  return `${id.symbol}|${id.expiryDate}|${id.strike}|${id.side}`;
}

/** Session-scoped exact premium facts only; no chase classification or market threshold. */
export class H1GoldChaseExactPremiumPathStore {
  private sessionDate: string | null = null;
  private readonly paths = new Map<string, H1GoldChasePremiumPoint[]>();
  private readonly blocked = new Map<string, string[]>();

  record(packet: LiveGateEvidencePacket, receivedAt: string): H1GoldChaseExactPremiumPathRecordResult {
    const id = packet?.identity;
    const key = candidateKey(packet);
    const observedMs = Date.parse(id?.observedAt ?? "");
    const receivedMs = Date.parse(receivedAt);
    const blockers: string[] = [];
    if (!id || !key || id.provenance !== "LIVE_RUNTIME_EXACT") blockers.push("EXACT_GOLD_TARGET_PACKET_REQUIRED");
    if (!Number.isFinite(id?.premiumLtp) || id.premiumLtp <= 0) blockers.push("EXACT_PREMIUM_LTP_REQUIRED");
    if (!Number.isFinite(observedMs) || !Number.isFinite(receivedMs)) blockers.push("EXACT_PREMIUM_TIMESTAMP_REQUIRED");
    if (Number.isFinite(observedMs) && Number.isFinite(receivedMs) && receivedMs < observedMs) blockers.push("PREMIUM_RECEIVED_BEFORE_OBSERVED");
    if (blockers.length > 0 || !id || !key) return this.recordResult("BLOCKED", key, 0, blockers);

    const date = tradingDateIst(observedMs);
    if (this.sessionDate && date < this.sessionDate) return this.recordResult("BLOCKED", key, 0, ["NON_FORWARD_TRADING_SESSION"]);
    if (this.sessionDate !== date) {
      this.paths.clear();
      this.blocked.clear();
      this.sessionDate = date;
    }
    const existingBlockers = this.blocked.get(key);
    if (existingBlockers) return this.recordResult("BLOCKED", key, 0, existingBlockers);

    const points = this.paths.get(key) ?? [];
    const duplicate = points.find((point) => point.observedAt === id.observedAt);
    if (duplicate) {
      if (duplicate.ltp === id.premiumLtp && duplicate.receivedAt === receivedAt) {
        return this.recordResult("IGNORED_DUPLICATE", key, points.length, []);
      }
      const reasons = ["DIVERGENT_DUPLICATE_PREMIUM_TIMESTAMP"];
      this.blocked.set(key, reasons);
      return this.recordResult("BLOCKED", key, 0, reasons);
    }
    const last = points.at(-1);
    if (last && Date.parse(last.observedAt) >= observedMs) {
      const reasons = ["NON_FORWARD_PREMIUM_CHRONOLOGY"];
      this.blocked.set(key, reasons);
      return this.recordResult("BLOCKED", key, 0, reasons);
    }

    points.push({
      source: "LIVE_RUNTIME_EXACT",
      symbol: id.symbol,
      expiry: id.expiryDate,
      strike: id.strike,
      optionType: id.side,
      ltp: id.premiumLtp,
      observedAt: id.observedAt,
      receivedAt,
    });
    this.paths.set(key, points);
    return this.recordResult("RECORDED", key, points.length, []);
  }

  pathFor(packet: LiveGateEvidencePacket): H1GoldChaseExactPremiumPathResult {
    const key = candidateKey(packet);
    const blockers = key ? this.blocked.get(key) ?? [] : ["EXACT_GOLD_TARGET_PACKET_REQUIRED"];
    const points = key && blockers.length === 0 ? this.paths.get(key) ?? [] : [];
    const exactT0 = Boolean(points.length > 0 && points.at(-1)?.observedAt === packet?.identity?.observedAt);
    const finalBlockers = [...new Set([...blockers, ...(!exactT0 ? ["EXACT_T0_PREMIUM_POINT_REQUIRED"] : [])])];
    return {
      version: H1_GOLD_CHASE_EXACT_PREMIUM_PATH_STORE_V1,
      ready: finalBlockers.length === 0,
      candidateKey: key,
      points: finalBlockers.length === 0 ? points.map((point) => ({ ...point })) : [],
      blockers: finalBlockers,
      productionImpact: "NONE",
      failClosed: true,
    };
  }

  clear(): void {
    this.paths.clear();
    this.blocked.clear();
    this.sessionDate = null;
  }

  private recordResult(
    state: H1GoldChaseExactPremiumPathRecordResult["state"],
    key: string | null,
    pointCount: number,
    blockers: string[],
  ): H1GoldChaseExactPremiumPathRecordResult {
    return {
      version: H1_GOLD_CHASE_EXACT_PREMIUM_PATH_STORE_V1,
      state,
      ready: state !== "BLOCKED",
      candidateKey: key,
      pointCount,
      blockers: [...new Set(blockers)],
      ...SAFETY,
    };
  }
}

export type TelegramTruthState = "TRUE" | "STALE" | "PARTIAL" | "INVALID";
export type TelegramDirection = "BULLISH" | "BEARISH" | "NEUTRAL" | "CONFLICTING" | "INSUFFICIENT_DATA";
export type TelegramHealth = "IMPROVING" | "STABLE" | "DETERIORATING" | "INVALID" | "UNAVAILABLE";
export type TelegramSymbol = "NIFTY" | "BANKNIFTY" | "SENSEX";
export type TelegramGroupName = "NIFTY" | "BANKNIFTY" | "SENSEX";
export type TelegramTfState =
  | "WARNING_ONLY"
  | "PROMOTED"
  | "CONFIRMED"
  | "STRUCTURAL_SUPPORT"
  | "HIGHER_ORDER_SUPPORT"
  | "CONFLICTING"
  | "REVERSING"
  | "INSUFFICIENT_DATA"
  | "UNAVAILABLE";

export interface TelegramEvidenceLine {
  label: string;
  state: "SUPPORTIVE" | "NEUTRAL" | "WARNING" | "CONFLICTING" | "UNAVAILABLE";
  detail?: string | null;
}

export interface TelegramCandidateBlock {
  side: "CE" | "PE" | "NONE";
  strike: number | null;
  expiry: string | null;
  dte: number | null;
  premium: number | null;
  health: TelegramHealth;
}

export interface TelegramTradePlanBlock {
  entry: number | null;
  sl: number | null;
  t1: number | null;
  t2: number | null;
  t3: number | null;
  rrToT1: number | null;
  rrToT2: number | null;
  rrToT3: number | null;
  status: "PENDING" | "ACTIVE" | "HOLD" | "TRAIL" | "REDUCE" | "EXIT" | "TARGET_HIT" | "INVALID" | "UNAVAILABLE";
}

export const TELEGRAM_INDEX_GROUP_ROUTING: Readonly<Record<TelegramSymbol, TelegramGroupName>> = {
  NIFTY: "NIFTY",
  BANKNIFTY: "BANKNIFTY",
  SENSEX: "SENSEX",
};

export interface CanonicalTelegramCard {
  schemaVersion: "TELEGRAM_CARD_V1";
  symbol: TelegramSymbol;
  generatedAt: string;

  routing: {
    groupName: TelegramGroupName;
    strictIndexIsolation: true;
    crossPostAllowed: false;
  };

  headline: {
    verdict: TelegramDirection;
    confidenceLabel: "HIGH" | "MEDIUM" | "LOW" | "UNAVAILABLE";
    truth: TelegramTruthState;
    freshnessSeconds: number | null;
  };

  timeframe: {
    m1: TelegramTfState;
    m3: TelegramTfState;
    m15: TelegramTfState;
    m30: TelegramTfState;
    m60: TelegramTfState;
  };

  coreEvidence: TelegramEvidenceLine[];
  contextEvidence: TelegramEvidenceLine[];
  conflicts: string[];
  warnings: string[];

  candidate: TelegramCandidateBlock;
  tradePlan: TelegramTradePlanBlock;

  reasons: string[];
  nextUpdateAt: string | null;

  safety: {
    forwardTestingOnly: boolean;
    affectsVerdict: boolean;
    affectsExecution: boolean;
  };
}

/**
 * Canonical Telegram card contract only.
 *
 * Routing is strict and index-isolated:
 * NIFTY -> Telegram group named NIFTY
 * BANKNIFTY -> Telegram group named BANKNIFTY
 * SENSEX -> Telegram group named SENSEX
 *
 * No card may be cross-posted to another index group. A future sender must
 * resolve the destination only through TELEGRAM_INDEX_GROUP_ROUTING and must
 * fail closed if the configured group/chat id does not match the card symbol.
 *
 * This file freezes output shape and routing intent. It deliberately does not
 * send Telegram, select a candidate, compute a verdict, change scoring, or
 * create orders. Missing data must stay null/UNAVAILABLE/INSUFFICIENT_DATA;
 * never fabricate.
 */
export const TELEGRAM_CARD_SECTIONS = [
  "INDEX + FINAL VERDICT",
  "TRUTH + FRESHNESS",
  "1M / 3M / 15M / 30M / 60M",
  "CORE EVIDENCE",
  "CONTEXT EVIDENCE",
  "CONFLICTS + WARNINGS",
  "BEST CE/PE CANDIDATE",
  "ENTRY / SL / T1 / T2 / T3",
  "CANDIDATE HEALTH",
  "NEXT UPDATE",
] as const;

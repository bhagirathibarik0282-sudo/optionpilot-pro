export const THREE_MINUTE_FUSED_MARKER = "OPTIONPILOT 3M FUSED VIEW" as const;

export type FusedStance = "BULLISH" | "BEARISH" | "NEUTRAL" | "PENDING";
export type FusedSymbol = "NIFTY" | "SENSEX";

export interface FusedFamilyInput {
  label: string;
  stance: FusedStance;
  verified: boolean;
  detail?: string | null;
}

export interface ThreeMinuteFusedInput {
  symbol: FusedSymbol;
  atLabel: string;
  families: FusedFamilyInput[];
  canonicalAction?: "BUY_CE" | "BUY_PE" | "WAIT" | null;
  canonicalCandidateKey?: string | null;
}

export interface ThreeMinuteFusedView {
  marker: typeof THREE_MINUTE_FUSED_MARKER;
  symbol: FusedSymbol;
  bias: "BULLISH" | "BEARISH" | "NEUTRAL";
  stars: 1 | 2 | 3 | 4 | 5;
  verifiedFamilyCount: number;
  pendingFamilyCount: number;
  canonicalAction: "BUY_CE" | "BUY_PE" | "WAIT";
  canonicalCandidateKey: string | null;
  fingerprint: string;
  text: string;
  createsOrders: false;
  affectsExecution: false;
  overridesSelector: false;
}

function normalizeDetail(value: string | null | undefined): string {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, 90);
}

function scoreFamilies(families: FusedFamilyInput[]): { score: number; verified: number; pending: number } {
  let score = 0;
  let verified = 0;
  let pending = 0;
  for (const family of families) {
    if (!family.verified || family.stance === "PENDING") {
      pending += 1;
      continue;
    }
    verified += 1;
    if (family.stance === "BULLISH") score += 1;
    if (family.stance === "BEARISH") score -= 1;
  }
  return { score, verified, pending };
}

function biasFrom(score: number): "BULLISH" | "BEARISH" | "NEUTRAL" {
  if (score > 0) return "BULLISH";
  if (score < 0) return "BEARISH";
  return "NEUTRAL";
}

function starsFrom(score: number, verified: number): 1 | 2 | 3 | 4 | 5 {
  if (verified <= 0) return 1;
  const conviction = Math.abs(score) / verified;
  if (conviction >= 0.8) return 5;
  if (conviction >= 0.6) return 4;
  if (conviction >= 0.4) return 3;
  if (conviction > 0) return 2;
  return 1;
}

function semanticFingerprint(input: ThreeMinuteFusedInput): string {
  const families = input.families
    .map((family) => `${family.label.trim().toUpperCase()}:${family.verified ? family.stance : "PENDING"}:${normalizeDetail(family.detail)}`)
    .sort()
    .join("|");
  return [input.symbol, families, input.canonicalAction ?? "WAIT", input.canonicalCandidateKey ?? "NONE"].join("|");
}

export function buildThreeMinuteFusedTelegramView(input: ThreeMinuteFusedInput): ThreeMinuteFusedView {
  const { score, verified, pending } = scoreFamilies(input.families);
  const bias = biasFrom(score);
  const stars = starsFrom(score, verified);
  const canonicalAction = input.canonicalAction ?? "WAIT";
  const starText = "★".repeat(stars) + "☆".repeat(5 - stars);
  const verifiedLines = input.families
    .filter((family) => family.verified && family.stance !== "PENDING")
    .map((family) => `${family.label}: ${family.stance}${normalizeDetail(family.detail) ? ` • ${normalizeDetail(family.detail)}` : ""}`);
  const pendingLabels = input.families
    .filter((family) => !family.verified || family.stance === "PENDING")
    .map((family) => family.label);

  const actionText = canonicalAction === "BUY_CE"
    ? "Canonical: BUY CE"
    : canonicalAction === "BUY_PE"
      ? "Canonical: BUY PE"
      : "Canonical: WAIT";

  const text = [
    `🧭 ${THREE_MINUTE_FUSED_MARKER}`,
    `${input.symbol} • ${input.atLabel} • ${bias} ${starText}`,
    ...verifiedLines.slice(0, 8),
    pendingLabels.length > 0 ? `Pending: ${pendingLabels.join(", ")}` : "All supplied families verified",
    actionText,
    "Monitor only • selector/execution unchanged",
  ].join("\n");

  return {
    marker: THREE_MINUTE_FUSED_MARKER,
    symbol: input.symbol,
    bias,
    stars,
    verifiedFamilyCount: verified,
    pendingFamilyCount: pending,
    canonicalAction,
    canonicalCandidateKey: input.canonicalCandidateKey ?? null,
    fingerprint: semanticFingerprint(input),
    text,
    createsOrders: false,
    affectsExecution: false,
    overridesSelector: false,
  };
}

export class ThreeMinuteFusedDedup {
  private readonly last = new Map<FusedSymbol, string>();

  shouldEmit(view: ThreeMinuteFusedView): boolean {
    const previous = this.last.get(view.symbol);
    if (previous === view.fingerprint) return false;
    this.last.set(view.symbol, view.fingerprint);
    return true;
  }

  clear(symbol?: FusedSymbol): void {
    if (symbol) this.last.delete(symbol);
    else this.last.clear();
  }
}

export function isThreeMinuteBoundary(date: Date): boolean {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? NaN);
  return Number.isInteger(minute) && minute % 3 === 0;
}

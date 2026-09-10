export const THREE_MINUTE_FUSED_MARKER = "OPTIONPILOT 3M FUSED VIEW" as const;

export type FusedStance = "BULLISH" | "BEARISH" | "NEUTRAL" | "PENDING";
export type FusedSymbol = "NIFTY" | "SENSEX" | "BANKNIFTY";
export type FusedWindow = "T0" | "T3" | "T6" | "T15" | "T30";

export interface FusedFamilyInput {
  label: string;
  stance: FusedStance;
  verified: boolean;
  detail?: string | null;
}

export interface FusedNumericInput {
  spot?: number | null;
  future?: number | null;
  basis?: number | null;
  pcr?: number | null;
  callWallStrike?: number | null;
  callWallStrength?: number | null;
  putWallStrike?: number | null;
  putWallStrength?: number | null;
  vix?: number | null;
  cePremium?: number | null;
  pePremium?: number | null;
}

export interface FusedTimelinePoint {
  label: FusedWindow;
  spotChange?: number | null;
  futureChange?: number | null;
  pcrChange?: number | null;
  vixChange?: number | null;
  cePremiumChangePct?: number | null;
  pePremiumChangePct?: number | null;
  state?: string | null;
}

export interface FusedPpdWindow {
  windowMinutes: 3 | 6 | 15;
  usable: boolean;
  rawPpdPp?: number | null;
  candidateOrientedPpdPp?: number | null;
  controllingSide?: "CE" | "PE" | null;
  candidateControlledExpansion?: boolean;
}

export interface FusedBreadthInput {
  summary?: string | null;
  leaders?: string[];
}

export interface ThreeMinuteFusedInput {
  symbol: FusedSymbol;
  atLabel: string;
  state?: string | null;
  families: FusedFamilyInput[];
  numeric?: FusedNumericInput;
  timeline?: FusedTimelinePoint[];
  ppd?: FusedPpdWindow[];
  heavyweights?: FusedBreadthInput;
  sectors?: FusedBreadthInput;
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
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, 120);
}

function n(value: number | null | undefined, digits = 2): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : "—";
}

function signed(value: number | null | undefined, digits = 2, suffix = ""): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}${suffix}`;
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

function biasFrom(score: number, verified: number): "BULLISH" | "BEARISH" | "NEUTRAL" {
  if (verified < 3) return "NEUTRAL";
  if (score > 0) return "BULLISH";
  if (score < 0) return "BEARISH";
  return "NEUTRAL";
}

function starsFrom(score: number, verified: number, pending: number): 1 | 2 | 3 | 4 | 5 {
  if (verified < 3) return 1;
  const conviction = Math.abs(score) / Math.max(verified, 1);
  let stars = conviction >= 0.8 ? 5 : conviction >= 0.6 ? 4 : conviction >= 0.4 ? 3 : conviction > 0 ? 2 : 1;
  if (pending >= 2) stars = Math.min(stars, 3);
  if (pending >= 4) stars = 1;
  return stars as 1 | 2 | 3 | 4 | 5;
}

function numericLines(x?: FusedNumericInput): string[] {
  if (!x) return [];
  return [
    `Spot ${n(x.spot)} | Fut ${n(x.future)} | Basis ${signed(x.basis)}`,
    `PCR ${n(x.pcr, 3)} | VIX ${n(x.vix, 2)} | CE ₹${n(x.cePremium)} | PE ₹${n(x.pePremium)}`,
    `CE Wall ${n(x.callWallStrike, 0)} • Strength ${n(x.callWallStrength, 2)} | PE Wall ${n(x.putWallStrike, 0)} • Strength ${n(x.putWallStrength, 2)}`,
  ];
}

function timelineLines(points?: FusedTimelinePoint[]): string[] {
  if (!points?.length) return ["Time Δ: —"];
  const by = new Map(points.map((p) => [p.label, p]));
  return (["T0", "T3", "T6", "T15", "T30"] as const).map((label) => {
    const p = by.get(label);
    if (!p) return `${label}: —`;
    return `${label}: Spot ${signed(p.spotChange)} | Fut ${signed(p.futureChange)} | PCR ${signed(p.pcrChange, 3)} | VIX ${signed(p.vixChange)} | CE ${signed(p.cePremiumChangePct, 1, "%")} | PE ${signed(p.pePremiumChangePct, 1, "%")}${p.state ? ` | ${normalizeDetail(p.state)}` : ""}`;
  });
}

function ppdLine(ppd?: FusedPpdWindow[]): string {
  if (!ppd?.length) return "PPD: —";
  const one = (m: 3 | 6 | 15) => {
    const w = ppd.find((x) => x.windowMinutes === m);
    if (!w?.usable) return `${m}m —`;
    return `${m}m ${signed(w.candidateOrientedPpdPp, 2, "pp")} ${w.controllingSide ?? "—"}${w.candidateControlledExpansion ? " ✓" : ""}`;
  };
  return `PPD: ${one(3)} | ${one(6)} | ${one(15)}`;
}

function breadthLine(label: string, input?: FusedBreadthInput): string {
  if (!input) return `${label}: —`;
  const leaders = (input.leaders ?? []).filter(Boolean).slice(0, 5).join(", ");
  const summary = normalizeDetail(input.summary);
  return `${label}: ${summary || "—"}${leaders ? ` | ${leaders}` : ""}`;
}

function semanticFingerprint(input: ThreeMinuteFusedInput): string {
  const families = input.families
    .map((family) => `${family.label.trim().toUpperCase()}:${family.verified ? family.stance : "PENDING"}:${normalizeDetail(family.detail)}`)
    .sort().join("|");
  const timeline = (input.timeline ?? []).map((p) => `${p.label}:${p.spotChange ?? ""}:${p.futureChange ?? ""}:${p.pcrChange ?? ""}:${p.vixChange ?? ""}:${p.cePremiumChangePct ?? ""}:${p.pePremiumChangePct ?? ""}:${p.state ?? ""}`).join("|");
  const ppd = (input.ppd ?? []).map((p) => `${p.windowMinutes}:${p.usable}:${p.candidateOrientedPpdPp ?? ""}:${p.controllingSide ?? ""}:${p.candidateControlledExpansion ?? false}`).join("|");
  return [input.symbol, input.state ?? "", families, JSON.stringify(input.numeric ?? {}), timeline, ppd, normalizeDetail(input.heavyweights?.summary), normalizeDetail(input.sectors?.summary), input.canonicalAction ?? "WAIT", input.canonicalCandidateKey ?? "NONE"].join("|");
}

export function buildThreeMinuteFusedTelegramView(input: ThreeMinuteFusedInput): ThreeMinuteFusedView {
  const { score, verified, pending } = scoreFamilies(input.families);
  const bias = biasFrom(score, verified);
  const stars = starsFrom(score, verified, pending);
  const canonicalAction = input.canonicalAction ?? "WAIT";
  const starText = "★".repeat(stars) + "☆".repeat(5 - stars);
  const readiness = verified < 3 ? "NOT READY" : bias;
  const state = normalizeDetail(input.state) || "UNRESOLVED";

  const familyLine = input.families.map((f) => `${f.label}:${!f.verified || f.stance === "PENDING" ? "—" : f.stance}`).join(" | ");
  const actionText = canonicalAction === "BUY_CE" ? "Action: BUY CE" : canonicalAction === "BUY_PE" ? "Action: BUY PE" : "Action: WAIT";
  const observation = input.symbol === "BANKNIFTY" ? "BANKNIFTY observation only" : "Selector authority unchanged";

  const text = [
    `🧭 ${THREE_MINUTE_FUSED_MARKER}`,
    `${input.symbol} • ${input.atLabel}`,
    `STATE: ${state} | FUSION: ${readiness} ${starText}`,
    ...numericLines(input.numeric),
    familyLine,
    ppdLine(input.ppd),
    breadthLine("Heavyweights", input.heavyweights),
    breadthLine("Sectors", input.sectors),
    "Time changes:",
    ...timelineLines(input.timeline),
    actionText,
    `Summary: ${verified}/${input.families.length} core families verified; ${pending} pending. ${observation}.`,
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
    if (symbol) this.last.delete(symbol); else this.last.clear();
  }
}

export function isThreeMinuteBoundary(date: Date): boolean {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? NaN);
  return Number.isInteger(minute) && minute % 3 === 0;
}

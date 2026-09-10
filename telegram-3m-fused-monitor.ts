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
  pcrFullChain?: number | null;
  pcrPlusMinus7?: number | null;
  pcrAtmNear?: number | null;
  pcrChangeOi?: number | null;
  pcrVolume?: number | null;
  pcrCurrentExpiry?: number | null;
  pcrNextExpiry?: number | null;
  callWallStrike?: number | null;
  callWallStrength?: number | null;
  putWallStrike?: number | null;
  putWallStrength?: number | null;
  vix?: number | null;
  cePremium?: number | null;
  pePremium?: number | null;
  ceOi?: number | null;
  peOi?: number | null;
  ceIv?: number | null;
  peIv?: number | null;
  atmIv?: number | null;
  ceBid?: number | null;
  ceAsk?: number | null;
  peBid?: number | null;
  peAsk?: number | null;
  ceVolume?: number | null;
  peVolume?: number | null;
  ceDelta?: number | null;
  peDelta?: number | null;
  ceGamma?: number | null;
  peGamma?: number | null;
  ceTheta?: number | null;
  peTheta?: number | null;
  ceVega?: number | null;
  peVega?: number | null;
}

export interface FusedTimelinePoint {
  label: FusedWindow;
  spotChange?: number | null;
  futureChange?: number | null;
  pcrChange?: number | null;
  vixChange?: number | null;
  cePremiumChangePct?: number | null;
  pePremiumChangePct?: number | null;
  ceOiChangePct?: number | null;
  peOiChangePct?: number | null;
  ceIvChange?: number | null;
  peIvChange?: number | null;
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
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, 160);
}
function n(value: number | null | undefined, digits = 2): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : "—";
}
function signed(value: number | null | undefined, digits = 2, suffix = ""): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}${suffix}`;
}
function spread(bid?: number | null, ask?: number | null): string {
  if (!Number.isFinite(Number(bid)) || !Number.isFinite(Number(ask))) return "—";
  return n(Number(ask) - Number(bid), 2);
}
function scoreFamilies(families: FusedFamilyInput[]): { score: number; verified: number; pending: number } {
  let score = 0, verified = 0, pending = 0;
  for (const family of families) {
    if (!family.verified || family.stance === "PENDING") { pending += 1; continue; }
    verified += 1;
    if (family.stance === "BULLISH") score += 1;
    if (family.stance === "BEARISH") score -= 1;
  }
  return { score, verified, pending };
}
function biasFrom(score: number, verified: number): "BULLISH" | "BEARISH" | "NEUTRAL" {
  if (verified < 3) return "NEUTRAL";
  return score > 0 ? "BULLISH" : score < 0 ? "BEARISH" : "NEUTRAL";
}
function starsFrom(score: number, verified: number, pending: number): 1 | 2 | 3 | 4 | 5 {
  if (verified < 3) return 1;
  const conviction = Math.abs(score) / Math.max(verified, 1);
  let stars = conviction >= .8 ? 5 : conviction >= .6 ? 4 : conviction >= .4 ? 3 : conviction > 0 ? 2 : 1;
  if (pending >= 2) stars = Math.min(stars, 3);
  if (pending >= 4) stars = 1;
  return stars as 1 | 2 | 3 | 4 | 5;
}
function byWindow(points?: FusedTimelinePoint[]) {
  return new Map((points ?? []).map((p) => [p.label, p]));
}
function timeRow(label: FusedWindow, points?: FusedTimelinePoint[]): string {
  const p = byWindow(points).get(label);
  if (!p) return `${label}: —`;
  return `${label}: Spot ${signed(p.spotChange)} | Fut ${signed(p.futureChange)} | PCR ${signed(p.pcrChange, 3)} | VIX ${signed(p.vixChange)} | CE ${signed(p.cePremiumChangePct, 1, "%")} | PE ${signed(p.pePremiumChangePct, 1, "%")}${p.state ? ` | ${normalizeDetail(p.state)}` : ""}`;
}
function optionOiRow(label: FusedWindow, points?: FusedTimelinePoint[]): string {
  const p = byWindow(points).get(label);
  return p ? `${label}: CE ${signed(p.ceOiChangePct, 1, "%")} | PE ${signed(p.peOiChangePct, 1, "%")}` : `${label}: —`;
}
function ivRow(label: FusedWindow, points?: FusedTimelinePoint[]): string {
  const p = byWindow(points).get(label);
  return p ? `${label}: CE IV ${signed(p.ceIvChange)} | PE IV ${signed(p.peIvChange)} | VIX ${signed(p.vixChange)}` : `${label}: —`;
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
function meaningFromFamily(families: FusedFamilyInput[], label: string): string {
  const f = families.find((x) => x.label.toLowerCase().includes(label.toLowerCase()));
  if (!f || !f.verified || f.stance === "PENDING") return "—";
  return `${f.stance}${f.detail ? ` • ${normalizeDetail(f.detail)}` : ""}`;
}
function semanticFingerprint(input: ThreeMinuteFusedInput): string {
  const families = input.families.map((f) => `${f.label}:${f.verified ? f.stance : "PENDING"}:${normalizeDetail(f.detail)}`).sort().join("|");
  const timeline = (input.timeline ?? []).map((p) => JSON.stringify(p)).join("|");
  const ppd = (input.ppd ?? []).map((p) => JSON.stringify(p)).join("|");
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
  const x = input.numeric ?? {};
  const actionText = canonicalAction === "BUY_CE" ? "Action: BUY CE" : canonicalAction === "BUY_PE" ? "Action: BUY PE" : "Action: WAIT";
  const buyerSide = canonicalAction === "BUY_CE" ? "CE" : canonicalAction === "BUY_PE" ? "PE" : bias === "BULLISH" ? "CE WATCH" : bias === "BEARISH" ? "PE WATCH" : "WAIT";
  const observation = input.symbol === "BANKNIFTY" ? "BANKNIFTY observation only" : "Selector authority unchanged";
  const familyLine = input.families.map((f) => `${f.label}:${!f.verified || f.stance === "PENDING" ? "—" : f.stance}`).join(" | ");
  const pcrCurrent = x.pcrFullChain ?? x.pcr;

  const text = [
    `🧭 ${THREE_MINUTE_FUSED_MARKER}`,
    `${input.symbol} • ${input.atLabel}`,
    `STATE: ${state} | FUSION: ${readiness} ${starText}`,
    `OPTION BUYER VIEW: ${buyerSide} | BUSINESS QUALITY: ${verified >= 4 ? "HIGH" : verified >= 3 ? "MEDIUM" : "LOW"}`,
    "",
    "📍 PRICE + FUTURES",
    `Spot ${n(x.spot)} | Fut ${n(x.future)} | Basis ${signed(x.basis)}`,
    timeRow("T0", input.timeline),
    timeRow("T3", input.timeline),
    timeRow("T6", input.timeline),
    timeRow("T15", input.timeline),
    timeRow("T30", input.timeline),
    `Meaning: ${meaningFromFamily(input.families, "Futures")}`,
    "",
    "💰 CE / PE PREMIUM",
    `CE ₹${n(x.cePremium)} | PE ₹${n(x.pePremium)}`,
    `3M: CE ${signed(byWindow(input.timeline).get("T3")?.cePremiumChangePct, 1, "%")} | PE ${signed(byWindow(input.timeline).get("T3")?.pePremiumChangePct, 1, "%")}`,
    `6M: CE ${signed(byWindow(input.timeline).get("T6")?.cePremiumChangePct, 1, "%")} | PE ${signed(byWindow(input.timeline).get("T6")?.pePremiumChangePct, 1, "%")}`,
    `15M: CE ${signed(byWindow(input.timeline).get("T15")?.cePremiumChangePct, 1, "%")} | PE ${signed(byWindow(input.timeline).get("T15")?.pePremiumChangePct, 1, "%")}`,
    `30M: CE ${signed(byWindow(input.timeline).get("T30")?.cePremiumChangePct, 1, "%")} | PE ${signed(byWindow(input.timeline).get("T30")?.pePremiumChangePct, 1, "%")}`,
    `Meaning: ${meaningFromFamily(input.families, "Premium")}`,
    "",
    "⚡ PPD — PREMIUM PAIR DIVERGENCE",
    ppdLine(input.ppd),
    "30m: — (PPD production support is 3m/6m/15m only)",
    "",
    "📊 PCR FAMILY",
    `Full ${n(pcrCurrent, 3)} | ±7 ${n(x.pcrPlusMinus7, 3)} | ATM ${n(x.pcrAtmNear, 3)} | Chg-OI ${n(x.pcrChangeOi, 3)} | Vol ${n(x.pcrVolume, 3)}`,
    `Current Expiry ${n(x.pcrCurrentExpiry, 3)} | Next Expiry ${n(x.pcrNextExpiry, 3)}`,
    `Velocity: 3M ${signed(byWindow(input.timeline).get("T3")?.pcrChange, 3)} | 6M ${signed(byWindow(input.timeline).get("T6")?.pcrChange, 3)} | 15M ${signed(byWindow(input.timeline).get("T15")?.pcrChange, 3)} | 30M ${signed(byWindow(input.timeline).get("T30")?.pcrChange, 3)}`,
    `Meaning: ${meaningFromFamily(input.families, "OI/PCR")}`,
    "",
    "🧱 CE / PE WALLS",
    `CE Wall ${n(x.callWallStrike, 0)} • Strength ${n(x.callWallStrength, 2)} | PE Wall ${n(x.putWallStrike, 0)} • Strength ${n(x.putWallStrength, 2)}`,
    "3M / 6M / 15M / 30M migration: — unless exact historical wall evidence is available",
    `Meaning: ${meaningFromFamily(input.families, "OI/PCR")}`,
    "",
    "📦 OPTION OI",
    `CE OI ${n(x.ceOi, 0)} | PE OI ${n(x.peOi, 0)}`,
    optionOiRow("T3", input.timeline), optionOiRow("T6", input.timeline), optionOiRow("T15", input.timeline), optionOiRow("T30", input.timeline),
    `Meaning: ${meaningFromFamily(input.families, "OI/PCR")}`,
    "",
    "🌡 IV + VIX",
    `CE IV ${n(x.ceIv)} | PE IV ${n(x.peIv)} | ATM IV ${n(x.atmIv)} | VIX ${n(x.vix)}`,
    ivRow("T3", input.timeline), ivRow("T6", input.timeline), ivRow("T15", input.timeline), ivRow("T30", input.timeline),
    `Meaning: ${meaningFromFamily(input.families, "IV/VIX")}`,
    "",
    "🧮 GREEKS REALITY",
    `CE Δ ${n(x.ceDelta, 3)} Γ ${n(x.ceGamma, 6)} Θ ${n(x.ceTheta, 2)} Vega ${n(x.ceVega, 2)}`,
    `PE Δ ${n(x.peDelta, 3)} Γ ${n(x.peGamma, 6)} Θ ${n(x.peTheta, 2)} Vega ${n(x.peVega, 2)}`,
    "Meaning: Greeks are context only; premium response remains the live reality check.",
    "",
    "💧 LIQUIDITY + EXECUTABILITY",
    `CE Bid/Ask ${n(x.ceBid)}/${n(x.ceAsk)} Spread ${spread(x.ceBid, x.ceAsk)} Vol ${n(x.ceVolume, 0)}`,
    `PE Bid/Ask ${n(x.peBid)}/${n(x.peAsk)} Spread ${spread(x.peBid, x.peAsk)} Vol ${n(x.peVolume, 0)}`,
    "Meaning: Missing/poor liquidity stays non-executable; no inference from unavailable values.",
    "",
    "🗓 MULTI-DTE",
    "Current / Next / Next-Next / Monthly: — unless verified expiry-specific evidence is present",
    "",
    "🏦 HEAVYWEIGHTS",
    breadthLine("Heavyweights", input.heavyweights),
    "",
    "🏭 SECTORS",
    breadthLine("Sectors", input.sectors),
    "",
    "🕯 STRUCTURE + CANDLE CONTEXT",
    `Structure: ${state}`,
    `Meaning: ${meaningFromFamily(input.families, "Structure")}`,
    "",
    "📚 HISTORICAL EDGE",
    "Historical match: — unless validated historical evidence is attached to the live packet",
    "",
    "🧠 CONFIRMATION MATRIX",
    familyLine || "—",
    `Alignment: ${verified}/${input.families.length} verified | ${pending} pending`,
    "",
    "🔎 BEHAVIOUR SUMMARY",
    `3M: ${normalizeDetail(byWindow(input.timeline).get("T3")?.state) || "—"}`,
    `6M: ${normalizeDetail(byWindow(input.timeline).get("T6")?.state) || "—"}`,
    `15M: ${normalizeDetail(byWindow(input.timeline).get("T15")?.state) || "—"}`,
    `30M: ${normalizeDetail(byWindow(input.timeline).get("T30")?.state) || "—"}`,
    "",
    "🎯 BUSINESS VERDICT",
    `Market Behaviour: ${readiness}`,
    `Best Side: ${buyerSide}`,
    `Opportunity Quality: ${verified >= 4 ? "HIGH" : verified >= 3 ? "MEDIUM" : "LOW"}`,
    actionText,
    `Summary: ${verified}/${input.families.length} core families verified; ${pending} pending. ${observation}.`,
    "",
    "⚠️ SAFETY",
    "No parameter independently creates a trade. Missing/unverified data = —. Canonical selector remains final authority.",
  ].join("\n");

  return {
    marker: THREE_MINUTE_FUSED_MARKER, symbol: input.symbol, bias, stars,
    verifiedFamilyCount: verified, pendingFamilyCount: pending, canonicalAction,
    canonicalCandidateKey: input.canonicalCandidateKey ?? null,
    fingerprint: semanticFingerprint(input), text,
    createsOrders: false, affectsExecution: false, overridesSelector: false,
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
  clear(symbol?: FusedSymbol): void { if (symbol) this.last.delete(symbol); else this.last.clear(); }
}

export function isThreeMinuteBoundary(date: Date): boolean {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? NaN);
  return Number.isInteger(minute) && minute % 3 === 0;
}

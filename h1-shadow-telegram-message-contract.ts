import type { H1ShadowMeaningfulChangePreview } from "./h1-shadow-meaningful-change-preview.js";

export type H1CommentaryTimeframe = "1m" | "3m" | "6m" | "15m" | "30m";
export type H1CommentaryState = "CONFIRMED" | "BUILDING" | "FADING" | "UNCHANGED" | "MISSING";

export interface H1CommentaryTimeframeView {
  timeframe: H1CommentaryTimeframe;
  side: "CE" | "PE" | "NONE";
  state: H1CommentaryState;
}

export interface H1CommentarySideCount {
  side: "CE" | "PE";
  activeCount: number;
  observedCount: number;
  premiumChangePct: number | null;
}

export interface H1LowNoiseMinuteCommentary {
  observedAt: string;
  selectedCandle: H1CommentaryTimeframe | "MISSING";
  marketMode: "TRENDING" | "TRANSITION" | "RANGE" | "MISSING";
  timeframeViews: H1CommentaryTimeframeView[];
  sameSide: H1CommentarySideCount | null;
  oppositeSide: H1CommentarySideCount | null;
}

export interface H1ShadowTelegramMessageContract {
  version: "H1_SHADOW_TELEGRAM_MESSAGE_CONTRACT_V1";
  ready: boolean;
  renderable: boolean;
  text: string | null;
  blockers: string[];
  productionImpact: "NONE";
  telegramSendAllowed: false;
  affectsTelegram: false;
  affectsVerdict: false;
  affectsExecution: false;
  grantsPromotionAuthority: false;
  failClosed: true;
  semantics: "LOW_NOISE_MINUTE_COMMENTARY_TEXT_ONLY_NO_TRANSPORT";
}

const VERSION = "H1_SHADOW_TELEGRAM_MESSAGE_CONTRACT_V1" as const;
const SEMANTICS = "LOW_NOISE_MINUTE_COMMENTARY_TEXT_ONLY_NO_TRANSPORT" as const;
const TF_ORDER: H1CommentaryTimeframe[] = ["1m", "3m", "6m", "15m", "30m"];

function contract(ready: boolean, renderable: boolean, text: string | null, blockers: string[]): H1ShadowTelegramMessageContract {
  return {
    version: VERSION, ready, renderable, text, blockers: [...new Set(blockers)],
    productionImpact: "NONE", telegramSendAllowed: false, affectsTelegram: false,
    affectsVerdict: false, affectsExecution: false, grantsPromotionAuthority: false,
    failClosed: true, semantics: SEMANTICS,
  };
}

function authorityViolation(preview: H1ShadowMeaningfulChangePreview): boolean {
  return preview.productionImpact !== "NONE" || preview.telegramSendAllowed ||
    preview.affectsTelegram || preview.affectsVerdict || preview.affectsExecution ||
    preview.grantsPromotionAuthority || !preview.failClosed;
}

function validSideCount(value: H1CommentarySideCount | null): boolean {
  return !!value && (value.side === "CE" || value.side === "PE") &&
    Number.isInteger(value.activeCount) && value.activeCount >= 0 &&
    Number.isInteger(value.observedCount) && value.observedCount > 0 &&
    value.activeCount <= value.observedCount &&
    (value.premiumChangePct == null || Number.isFinite(value.premiumChangePct));
}

function validCommentary(value: H1LowNoiseMinuteCommentary | null): value is H1LowNoiseMinuteCommentary {
  if (!value || !Number.isFinite(Date.parse(value.observedAt))) return false;
  if (value.selectedCandle === "MISSING" || value.marketMode === "MISSING") return false;
  if (!validSideCount(value.sameSide) || !validSideCount(value.oppositeSide)) return false;
  if (value.sameSide!.side === value.oppositeSide!.side) return false;
  const seen = new Set<string>();
  for (const row of value.timeframeViews) {
    if (!TF_ORDER.includes(row.timeframe) || seen.has(row.timeframe)) return false;
    if (!["CE", "PE", "NONE"].includes(row.side)) return false;
    if (!["CONFIRMED", "BUILDING", "FADING", "UNCHANGED", "MISSING"].includes(row.state)) return false;
    seen.add(row.timeframe);
  }
  return seen.size === TF_ORDER.length;
}

function sideLine(label: string, value: H1CommentarySideCount): string {
  const premium = value.premiumChangePct == null
    ? "premium MISSING"
    : `premium ${value.premiumChangePct >= 0 ? "+" : ""}${value.premiumChangePct.toFixed(2)}%`;
  return `${label} ${value.side}: ${value.activeCount}/${value.observedCount} active | ${premium}`;
}

export function renderH1ShadowTelegramMessage(
  preview: H1ShadowMeaningfulChangePreview | null,
  commentary: H1LowNoiseMinuteCommentary | null = null,
): H1ShadowTelegramMessageContract {
  if (preview && authorityViolation(preview)) {
    return contract(false, false, null, ["PREVIEW_AUTHORITY_CONTRACT_VIOLATION"]);
  }

  const validPreviewTime = !!preview?.observedAt && Number.isFinite(Date.parse(preview.observedAt));
  const previewReady = !!preview?.ready && preview.blockers.length === 0 && validPreviewTime;
  const commentaryReady = validCommentary(commentary);
  const missing: string[] = [];
  if (!previewReady) missing.push(preview ? "PREVIEW_NOT_READY" : "MISSING_MEANINGFUL_CHANGE_PREVIEW");
  if (!commentaryReady) missing.push("MISSING_LOW_NOISE_MINUTE_COMMENTARY");

  const lines = [
    "MEANINGFUL MARKET MESSAGE",
    `Observed: ${commentaryReady ? commentary.observedAt : (validPreviewTime ? preview!.observedAt : "MISSING")}`,
  ];

  if (!commentaryReady) {
    lines.push("Live commentary: MISSING", "Timeframes: MISSING", "Same side: MISSING", "Opposite side: MISSING");
  } else {
    const views = TF_ORDER.map((tf) => {
      const row = commentary.timeframeViews.find((x) => x.timeframe === tf)!;
      return `${tf} ${row.side} ${row.state}`;
    });
    lines.push(
      `Mode: ${commentary.marketMode} | Selected candle: ${commentary.selectedCandle}`,
      `Timeframes: ${views.join(" | ")}`,
      sideLine("Same side", commentary.sameSide),
      sideLine("Opposite side", commentary.oppositeSide),
    );
  }

  if (!previewReady || !commentaryReady || !preview) {
    lines.push("Gate status: MISSING", "Kite trade push: BLOCKED");
    return contract(false, true, lines.join("\n"), [...(preview?.blockers ?? []), ...missing]);
  }

  lines.push(`Update: ${preview.meaningfulChange ? (preview.kind ?? "MATERIAL CHANGE") : "STRUCTURE UNCHANGED"}`);
  for (const decision of preview.decisions) {
    const gates = Object.entries(decision.gates)
      .map(([name, passed]) => `${name}=${passed ? "CONFIRMED" : "NOT CONFIRMED"}`)
      .join(", ");
    const action = decision.decision === "SELECT" ? "KITE PUSH CANDIDATE" : "WAIT";
    lines.push(`${decision.key} → ${action} [${gates || "GATES MISSING"}]`);
  }
  if (preview.decisions.length === 0) lines.push("Candidate: MISSING | Kite trade push: BLOCKED");

  return contract(true, true, lines.join("\n"), []);
}

import type {
  H1CommentarySideCount,
  H1CommentaryState,
  H1CommentaryTimeframe,
  H1CommentaryTimeframeView,
  H1LowNoiseMinuteCommentary,
} from "./h1-shadow-telegram-message-contract.js";

export interface H1CommentarySideEvidence {
  activeCount: number;
  observedCount: number;
  premiumChangePct: number | null;
}

export interface H1CommentaryFrameEvidence {
  timeframe: H1CommentaryTimeframe;
  observedAt: string;
  fresh: boolean;
  ce: H1CommentarySideEvidence;
  pe: H1CommentarySideEvidence;
}

export interface H1MinuteCommentaryPolicy {
  minimumActiveRatio: number;
  minimumPremiumChangePct: number;
  minimumLeadScore: number;
}

export interface H1MinuteCommentaryBuildResult {
  version: "H1_LOW_NOISE_MINUTE_COMMENTARY_BUILDER_V1";
  ready: boolean;
  commentary: H1LowNoiseMinuteCommentary | null;
  blockers: string[];
  productionImpact: "NONE";
  affectsTelegram: false;
  affectsVerdict: false;
  affectsExecution: false;
  failClosed: true;
}

const ORDER: H1CommentaryTimeframe[] = ["1m", "3m", "6m", "15m", "30m"];

function validPolicy(p: H1MinuteCommentaryPolicy): boolean {
  return Number.isFinite(p?.minimumActiveRatio) && p.minimumActiveRatio > 0 && p.minimumActiveRatio <= 1 &&
    Number.isFinite(p?.minimumPremiumChangePct) && p.minimumPremiumChangePct >= 0 &&
    Number.isFinite(p?.minimumLeadScore) && p.minimumLeadScore >= 0;
}

function validSide(x: H1CommentarySideEvidence): boolean {
  return Number.isInteger(x?.activeCount) && x.activeCount >= 0 &&
    Number.isInteger(x?.observedCount) && x.observedCount > 0 &&
    x.activeCount <= x.observedCount &&
    (x.premiumChangePct == null || Number.isFinite(x.premiumChangePct));
}

function validFrame(x: H1CommentaryFrameEvidence): boolean {
  return ORDER.includes(x?.timeframe) && Number.isFinite(Date.parse(x?.observedAt)) &&
    x.fresh === true && validSide(x.ce) && validSide(x.pe) &&
    x.ce.premiumChangePct != null && x.pe.premiumChangePct != null;
}

function strength(x: H1CommentarySideEvidence): number {
  const ratio = x.activeCount / x.observedCount;
  const premium = Math.max(x.premiumChangePct ?? 0, 0);
  return ratio + Math.min(premium / 10, 1);
}

function view(frame: H1CommentaryFrameEvidence | undefined, policy: H1MinuteCommentaryPolicy): H1CommentaryTimeframeView {
  if (!frame || !validFrame(frame)) return { timeframe: frame?.timeframe ?? "1m", side: "NONE", state: "MISSING" };
  const ceStrength = strength(frame.ce);
  const peStrength = strength(frame.pe);
  const lead = Math.abs(ceStrength - peStrength);
  if (lead < policy.minimumLeadScore) return { timeframe: frame.timeframe, side: "NONE", state: "UNCHANGED" };

  const side = ceStrength > peStrength ? "CE" : "PE";
  const evidence = side === "CE" ? frame.ce : frame.pe;
  const ratio = evidence.activeCount / evidence.observedCount;
  let state: H1CommentaryState;
  if ((evidence.premiumChangePct ?? 0) < 0) state = "FADING";
  else if (ratio >= policy.minimumActiveRatio && (evidence.premiumChangePct ?? 0) >= policy.minimumPremiumChangePct) state = "CONFIRMED";
  else state = "BUILDING";
  return { timeframe: frame.timeframe, side, state };
}

function aggregate(
  frames: H1CommentaryFrameEvidence[],
  side: "CE" | "PE",
): H1CommentarySideCount {
  const values = frames.filter(validFrame).map((x) => side === "CE" ? x.ce : x.pe);
  const observedCount = values.reduce((n, x) => n + x.observedCount, 0);
  const activeCount = values.reduce((n, x) => n + x.activeCount, 0);
  const weightedPremium = observedCount === 0 ? null : values.reduce(
    (n, x) => n + (x.premiumChangePct ?? 0) * x.observedCount,
    0,
  ) / observedCount;
  return { side, activeCount, observedCount, premiumChangePct: weightedPremium };
}

export function buildH1LowNoiseMinuteCommentary(
  frames: H1CommentaryFrameEvidence[],
  nowIso: string,
  policy: H1MinuteCommentaryPolicy,
): H1MinuteCommentaryBuildResult {
  const blockers: string[] = [];
  if (!validPolicy(policy)) blockers.push("INVALID_MINUTE_COMMENTARY_POLICY");
  if (!Number.isFinite(Date.parse(nowIso))) blockers.push("INVALID_MINUTE_COMMENTARY_TIME");
  if (!Array.isArray(frames)) blockers.push("MISSING_TIMEFRAME_EVIDENCE");
  if (blockers.length > 0) return blocked(blockers);

  const byTimeframe = new Map<H1CommentaryTimeframe, H1CommentaryFrameEvidence>();
  for (const frame of frames) {
    if (byTimeframe.has(frame.timeframe)) return blocked(["DUPLICATE_TIMEFRAME_EVIDENCE"]);
    byTimeframe.set(frame.timeframe, frame);
  }

  const views = ORDER.map((tf) => {
    const frame = byTimeframe.get(tf);
    return frame ? view(frame, policy) : { timeframe: tf, side: "NONE", state: "MISSING" as const };
  });
  const oneMinute = views[0];
  if (oneMinute.state === "MISSING" || oneMinute.side === "NONE") {
    return blocked(["ONE_MINUTE_DIRECTIONAL_EVIDENCE_MISSING"]);
  }

  const candidates = views.filter((x) => x.side === oneMinute.side && (x.state === "CONFIRMED" || x.state === "BUILDING"));
  const selected = [...candidates].reverse()[0];
  if (!selected) return blocked(["SELECTED_CANDLE_UNAVAILABLE"]);

  const opposite = oneMinute.side === "CE" ? "PE" : "CE";
  const commentary: H1LowNoiseMinuteCommentary = {
    observedAt: nowIso,
    selectedCandle: selected.timeframe,
    marketMode: selected.timeframe === "15m" || selected.timeframe === "30m"
      ? "TRENDING"
      : selected.timeframe === "1m" ? "RANGE" : "TRANSITION",
    timeframeViews: views,
    sameSide: aggregate(frames, oneMinute.side),
    oppositeSide: aggregate(frames, opposite),
  };

  return {
    version: "H1_LOW_NOISE_MINUTE_COMMENTARY_BUILDER_V1", ready: true,
    commentary, blockers: [], productionImpact: "NONE", affectsTelegram: false,
    affectsVerdict: false, affectsExecution: false, failClosed: true,
  };
}

function blocked(blockers: string[]): H1MinuteCommentaryBuildResult {
  return {
    version: "H1_LOW_NOISE_MINUTE_COMMENTARY_BUILDER_V1", ready: false,
    commentary: null, blockers: [...new Set(blockers)], productionImpact: "NONE",
    affectsTelegram: false, affectsVerdict: false, affectsExecution: false, failClosed: true,
  };
}

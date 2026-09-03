import type { H1ShadowMeaningfulChangePreview } from "./h1-shadow-meaningful-change-preview.js";

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
  semantics: "SHADOW_MINUTE_STATUS_TO_TEXT_ONLY_NO_TRANSPORT";
}

const VERSION = "H1_SHADOW_TELEGRAM_MESSAGE_CONTRACT_V1" as const;
const SEMANTICS = "SHADOW_MINUTE_STATUS_TO_TEXT_ONLY_NO_TRANSPORT" as const;

function contract(
  ready: boolean,
  renderable: boolean,
  text: string | null,
  blockers: string[],
): H1ShadowTelegramMessageContract {
  return {
    version: VERSION,
    ready,
    renderable,
    text,
    blockers: [...new Set(blockers)],
    productionImpact: "NONE",
    telegramSendAllowed: false,
    affectsTelegram: false,
    affectsVerdict: false,
    affectsExecution: false,
    grantsPromotionAuthority: false,
    failClosed: true,
    semantics: SEMANTICS,
  };
}

function authorityViolation(preview: H1ShadowMeaningfulChangePreview): boolean {
  return preview.productionImpact !== "NONE" ||
    preview.telegramSendAllowed ||
    preview.affectsTelegram ||
    preview.affectsVerdict ||
    preview.affectsExecution ||
    preview.grantsPromotionAuthority ||
    !preview.failClosed;
}

/**
 * Produces one renderable shadow status for every minute. Missing/unready data
 * is shown explicitly as MISSING. Gate disagreement is expressed only as
 * NOT CONFIRMED; raw reason labels are never rendered.
 */
export function renderH1ShadowTelegramMessage(
  preview: H1ShadowMeaningfulChangePreview | null,
): H1ShadowTelegramMessageContract {
  if (!preview) {
    return contract(false, true, [
      "H1 SHADOW ONE-MINUTE STATUS",
      "Data: MISSING",
      "Market tracking: WAIT",
      "Kite trade push: BLOCKED",
    ].join("\n"), ["MISSING_MEANINGFUL_CHANGE_PREVIEW"]);
  }

  if (authorityViolation(preview)) {
    return contract(false, false, null, ["PREVIEW_AUTHORITY_CONTRACT_VIOLATION"]);
  }

  const validTimestamp = !!preview.observedAt && Number.isFinite(Date.parse(preview.observedAt));
  if (!preview.ready || preview.blockers.length > 0 || !validTimestamp) {
    const blockers = [
      ...preview.blockers,
      ...(!preview.ready ? ["PREVIEW_NOT_READY"] : []),
      ...(!validTimestamp ? ["INVALID_PREVIEW_TIMESTAMP"] : []),
    ];
    return contract(false, true, [
      "H1 SHADOW ONE-MINUTE STATUS",
      `Observed: ${validTimestamp ? preview.observedAt : "MISSING"}`,
      "Data: MISSING",
      "Market tracking: WAIT",
      "Kite trade push: BLOCKED",
    ].join("\n"), blockers);
  }

  const lines = [
    "H1 SHADOW ONE-MINUTE STATUS",
    `Observed: ${preview.observedAt}`,
    `Update: ${preview.meaningfulChange ? (preview.kind ?? "MATERIAL CHANGE") : "STRUCTURE UNCHANGED"}`,
    `Added: ${preview.added.length ? preview.added.join(", ") : "none"}`,
    `Removed: ${preview.removed.length ? preview.removed.join(", ") : "none"}`,
    `Changed: ${preview.changed.length ? preview.changed.join(", ") : "none"}`,
  ];

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

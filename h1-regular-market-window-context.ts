export const H1_REGULAR_MARKET_WINDOW_CONTEXT_VERSION = "H1_REGULAR_MARKET_WINDOW_CONTEXT_V1" as const;

export type H1RegularMarketWindowState = "WITHIN_REGULAR_MARKET_WINDOW" | "OUTSIDE_REGULAR_MARKET_WINDOW";
export type H1StaleEvidenceInterpretation = "REQUIRES_LIVE_EVIDENCE_CHECK" | "EXPECTED_OUTSIDE_REGULAR_MARKET_WINDOW";

export interface H1RegularMarketWindowContext {
  version: typeof H1_REGULAR_MARKET_WINDOW_CONTEXT_VERSION;
  timezone: "Asia/Kolkata";
  regularWindowStart: "09:15";
  regularWindowEnd: "15:30";
  regularMarketWindowState: H1RegularMarketWindowState;
  staleEvidenceInterpretation: H1StaleEvidenceInterpretation;
  holidayCalendarVerified: false;
  claimsMarketOpen: false;
  productionImpact: "NONE";
  affectsVerdict: false;
  affectsExecution: false;
  affectsTelegram: false;
  failClosed: true;
}

function istMinutesOfDay(now: Date): number {
  const shifted = new Date(now.getTime() + (5 * 60 + 30) * 60 * 1000);
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
}

export function getH1RegularMarketWindowContext(now = new Date()): H1RegularMarketWindowContext {
  const minutes = istMinutesOfDay(now);
  const start = 9 * 60 + 15;
  const end = 15 * 60 + 30;
  const within = minutes >= start && minutes <= end;
  return {
    version: H1_REGULAR_MARKET_WINDOW_CONTEXT_VERSION,
    timezone: "Asia/Kolkata",
    regularWindowStart: "09:15",
    regularWindowEnd: "15:30",
    regularMarketWindowState: within ? "WITHIN_REGULAR_MARKET_WINDOW" : "OUTSIDE_REGULAR_MARKET_WINDOW",
    staleEvidenceInterpretation: within ? "REQUIRES_LIVE_EVIDENCE_CHECK" : "EXPECTED_OUTSIDE_REGULAR_MARKET_WINDOW",
    holidayCalendarVerified: false,
    claimsMarketOpen: false,
    productionImpact: "NONE",
    affectsVerdict: false,
    affectsExecution: false,
    affectsTelegram: false,
    failClosed: true,
  };
}

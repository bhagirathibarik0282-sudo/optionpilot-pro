export type IndianEquityMarketPhase =
  | "WEEKEND"
  | "HOLIDAY"
  | "PREMARKET"
  | "OPENING_GRACE"
  | "LIVE_SESSION"
  | "POSTMARKET";

export interface IndianEquityTradingHoliday {
  date: string;
  name: string;
  segments: "NSE_BSE_EQUITY_AND_EQUITY_DERIVATIVES";
}

// NSE/BSE equity and equity-derivatives full-day closures for 2026.
// Keep this explicit and reviewed: a missing calendar must never be inferred
// from quote freshness, because a broker can return the previous close with a
// fresh backend receipt timestamp on a holiday.
export const INDIAN_EQUITY_TRADING_HOLIDAYS_2026: readonly IndianEquityTradingHoliday[] = [
  { date: "2026-01-15", name: "Municipal Corporation Election - Maharashtra", segments: "NSE_BSE_EQUITY_AND_EQUITY_DERIVATIVES" },
  { date: "2026-01-26", name: "Republic Day", segments: "NSE_BSE_EQUITY_AND_EQUITY_DERIVATIVES" },
  { date: "2026-03-03", name: "Holi", segments: "NSE_BSE_EQUITY_AND_EQUITY_DERIVATIVES" },
  { date: "2026-03-26", name: "Shri Ram Navami", segments: "NSE_BSE_EQUITY_AND_EQUITY_DERIVATIVES" },
  { date: "2026-03-31", name: "Shri Mahavir Jayanti", segments: "NSE_BSE_EQUITY_AND_EQUITY_DERIVATIVES" },
  { date: "2026-04-03", name: "Good Friday", segments: "NSE_BSE_EQUITY_AND_EQUITY_DERIVATIVES" },
  { date: "2026-04-14", name: "Dr. Baba Saheb Ambedkar Jayanti", segments: "NSE_BSE_EQUITY_AND_EQUITY_DERIVATIVES" },
  { date: "2026-05-01", name: "Maharashtra Day", segments: "NSE_BSE_EQUITY_AND_EQUITY_DERIVATIVES" },
  { date: "2026-05-28", name: "Bakri Id", segments: "NSE_BSE_EQUITY_AND_EQUITY_DERIVATIVES" },
  { date: "2026-06-26", name: "Muharram", segments: "NSE_BSE_EQUITY_AND_EQUITY_DERIVATIVES" },
  { date: "2026-09-14", name: "Ganesh Chaturthi", segments: "NSE_BSE_EQUITY_AND_EQUITY_DERIVATIVES" },
  { date: "2026-10-02", name: "Mahatma Gandhi Jayanti", segments: "NSE_BSE_EQUITY_AND_EQUITY_DERIVATIVES" },
  { date: "2026-10-20", name: "Dussehra", segments: "NSE_BSE_EQUITY_AND_EQUITY_DERIVATIVES" },
  { date: "2026-11-10", name: "Diwali-Balipratipada", segments: "NSE_BSE_EQUITY_AND_EQUITY_DERIVATIVES" },
  { date: "2026-11-24", name: "Prakash Gurpurb Sri Guru Nanak Dev", segments: "NSE_BSE_EQUITY_AND_EQUITY_DERIVATIVES" },
  { date: "2026-12-25", name: "Christmas", segments: "NSE_BSE_EQUITY_AND_EQUITY_DERIVATIVES" },
] as const;

const HOLIDAY_BY_DATE = new Map(INDIAN_EQUITY_TRADING_HOLIDAYS_2026.map((holiday) => [holiday.date, holiday]));

function indiaClock(now: Date): { date: string; weekday: string; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const part = (type: string): string => parts.find((entry) => entry.type === type)?.value ?? "";
  return {
    date: `${part("year")}-${part("month")}-${part("day")}`,
    weekday: part("weekday"),
    minutes: Number(part("hour")) * 60 + Number(part("minute")),
  };
}

export function indianTradingDateAt(now: Date): string {
  return indiaClock(now).date;
}

export function indianEquityHolidayAt(now: Date): IndianEquityTradingHoliday | null {
  return HOLIDAY_BY_DATE.get(indianTradingDateAt(now)) ?? null;
}

export function indianEquityMarketPhaseAt(now: Date): IndianEquityMarketPhase {
  const clock = indiaClock(now);
  if (clock.weekday === "Sat" || clock.weekday === "Sun") return "WEEKEND";
  if (HOLIDAY_BY_DATE.has(clock.date)) return "HOLIDAY";
  if (clock.minutes < 9 * 60 + 15) return "PREMARKET";
  // Two 3-minute cycles are reserved for recorder/quote initialization.
  if (clock.minutes < 9 * 60 + 21) return "OPENING_GRACE";
  if (clock.minutes <= 15 * 60 + 30) return "LIVE_SESSION";
  return "POSTMARKET";
}

export function isIndianEquityMarketOpenAt(now: Date): boolean {
  const phase = indianEquityMarketPhaseAt(now);
  // Transport/recorder loops start at the 09:15 exchange open so the
  // opening structure is captured. Candidate gates remain stricter because
  // they separately require phase === LIVE_SESSION (after opening grace).
  return phase === "OPENING_GRACE" || phase === "LIVE_SESSION";
}

export function isClosedCalendarPhase(phase: IndianEquityMarketPhase): boolean {
  return phase === "WEEKEND" || phase === "HOLIDAY";
}

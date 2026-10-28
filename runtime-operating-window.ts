import { indianTradingDateAt, indianEquityHolidayAt } from './market-session-calendar.js';

export function runtimeWindowOpen(now = new Date()): boolean {
  if (!Number.isFinite(now.getTime())) return false;
  const day = new Date(now.getTime() + 19_800_000);
  if ([0, 6].includes(day.getUTCDay()) || indianEquityHolidayAt(now)) return false;
  const minute = day.getUTCHours() * 60 + day.getUTCMinutes();
  return minute >= 525 && minute < 975; // 08:45 inclusive, 16:15 exclusive IST.
}

export function maintenanceExpiry(value: unknown, now = new Date()): number {
  const expiry = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(expiry) && expiry > now.getTime() &&
    expiry <= now.getTime() + 60 * 60_000 ? expiry : 0;
}

export function operatingStatus(now = new Date(), overrideUntil = 0) {
  const scheduled = runtimeWindowOpen(now);
  return { tradingDate: indianTradingDateAt(now), scheduled,
    maintenance: overrideUntil > now.getTime(),
    shouldRun: scheduled || overrideUntil > now.getTime() };
}

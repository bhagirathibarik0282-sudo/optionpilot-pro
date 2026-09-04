export const H1_WEEKDAY_ACCEPTANCE_CAPTURE_SCHEDULER_VERSION = "H1_WEEKDAY_ACCEPTANCE_CAPTURE_SCHEDULER_V1" as const;
export const H1_WEEKDAY_ACCEPTANCE_CAPTURE_HOUR_IST = 9 as const;
export const H1_WEEKDAY_ACCEPTANCE_CAPTURE_MINUTE_IST = 18 as const;

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

function isWeekendUtcDay(day: number): boolean {
  return day === 0 || day === 6;
}

export function nextH1WeekdayAcceptanceCaptureAt(now = new Date()): Date {
  const shiftedNow = new Date(now.getTime() + IST_OFFSET_MS);
  let candidate = new Date(Date.UTC(
    shiftedNow.getUTCFullYear(),
    shiftedNow.getUTCMonth(),
    shiftedNow.getUTCDate(),
    H1_WEEKDAY_ACCEPTANCE_CAPTURE_HOUR_IST,
    H1_WEEKDAY_ACCEPTANCE_CAPTURE_MINUTE_IST,
    0,
    0,
  ));

  if (candidate.getTime() <= shiftedNow.getTime()) {
    candidate = new Date(candidate.getTime() + 24 * 60 * 60 * 1000);
  }
  while (isWeekendUtcDay(candidate.getUTCDay())) {
    candidate = new Date(candidate.getTime() + 24 * 60 * 60 * 1000);
  }
  return new Date(candidate.getTime() - IST_OFFSET_MS);
}

export type H1WeekdayAcceptanceCaptureCancel = () => void;

export function scheduleH1WeekdayAcceptanceCapture(
  callback: () => void,
  nowFn: () => Date = () => new Date(),
): H1WeekdayAcceptanceCaptureCancel {
  let cancelled = false;
  let timer: NodeJS.Timeout | null = null;

  const scheduleNext = (): void => {
    if (cancelled) return;
    const now = nowFn();
    const target = nextH1WeekdayAcceptanceCaptureAt(now);
    const delayMs = Math.max(0, target.getTime() - now.getTime());
    timer = setTimeout(() => {
      timer = null;
      if (cancelled) return;
      callback();
      scheduleNext();
    }, delayMs);
    timer.unref?.();
  };

  scheduleNext();
  return () => {
    cancelled = true;
    if (timer) clearTimeout(timer);
    timer = null;
  };
}

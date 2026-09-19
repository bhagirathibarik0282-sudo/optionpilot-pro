export const FII_DII_CASH_CATCHUP_SCHEDULER_VERSION = "FII_DII_CASH_CATCHUP_SCHEDULER_V1" as const;
export const FII_DII_CASH_CATCHUP_HOUR_IST = 19 as const;
export const FII_DII_CASH_CATCHUP_MINUTE_IST = 0 as const;

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

export function nextFiiDiiCashCatchupAt(now = new Date()): Date {
  const shiftedNow = new Date(now.getTime() + IST_OFFSET_MS);
  let candidate = new Date(Date.UTC(
    shiftedNow.getUTCFullYear(),
    shiftedNow.getUTCMonth(),
    shiftedNow.getUTCDate(),
    FII_DII_CASH_CATCHUP_HOUR_IST,
    FII_DII_CASH_CATCHUP_MINUTE_IST,
    0,
    0,
  ));
  if (candidate.getTime() <= shiftedNow.getTime()) {
    candidate = new Date(candidate.getTime() + 24 * 60 * 60 * 1000);
  }
  return new Date(candidate.getTime() - IST_OFFSET_MS);
}

export type FiiDiiCashCatchupCancel = () => void;

export function scheduleFiiDiiCashCatchup(
  callback: () => void,
  nowFn: () => Date = () => new Date(),
): FiiDiiCashCatchupCancel {
  let cancelled = false;
  let timer: NodeJS.Timeout | null = null;

  const scheduleNext = (): void => {
    if (cancelled) return;
    const now = nowFn();
    const target = nextFiiDiiCashCatchupAt(now);
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

/** Opening gap only; intraday day-change must never share this field. */
export function openingGapPercent(open: number | null | undefined, previousClose: number | null | undefined): number | null {
  if (typeof open !== "number" || !Number.isFinite(open) || open <= 0
    || typeof previousClose !== "number" || !Number.isFinite(previousClose) || previousClose <= 0) return null;
  return ((open - previousClose) / previousClose) * 100;
}

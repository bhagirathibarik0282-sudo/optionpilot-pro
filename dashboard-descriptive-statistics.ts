/** Pure browser-compatible summary of loaded observations; no storage or signal authority. */
export function deriveDashboardStatistics(current: any, symbol: string, expiry: string, contractKey: string, tradeDate: string) {
  const num = (v: any): number | null => (typeof v === 'number' || typeof v === 'string' && v.trim() !== '') && Number.isFinite(Number(v)) ? Number(v) : null;
  const day = (t: number) => new Date(t + 19800000).toISOString().slice(0, 10);
  const key = (r: any) => [r.symbol, String(r.expiry).slice(0, 10), r.strike, r.option_type].join('|');
  const quantile = (values: number[], p: number) => {
    const a = [...values].sort((a, b) => a - b), pos = (a.length - 1) * p, lo = Math.floor(pos);
    return a.length ? a[lo] + (a[Math.ceil(pos)] - a[lo]) * (pos - lo) : null;
  };
  const series = (rows: any[], field: string, label: string, unit: string, percentage: boolean, exactDte = false) => {
    const buckets = new Map<number, any[]>();
    for (const row of rows) {
      const t = Date.parse(row.minute_bucket);
      if (!Number.isFinite(t) || day(t) !== tradeDate || row.symbol !== symbol) continue;
      buckets.set(t, [...(buckets.get(t) || []), row]);
    }
    // Ambiguous duplicate timestamps stay unavailable rather than choosing a favourable value.
    const points = [...buckets].sort((a, b) => a[0] - b[0]).map(([t, rs]) => {
      const r = rs[0], conflict = rs.some(v => num(v[field]) !== num(r[field]) || v.truth_verdict !== r.truth_verdict || exactDte && num(v.dte) !== num(r.dte));
      const value = num(r[field]), invalid = value !== null && (value < 0 || percentage && value === 0);
      return {t, value: conflict || invalid || r.truth_verdict && r.truth_verdict !== 'TRUE' ? null : value, dte: num(r.dte), conflict};
    });
    const last = points.at(-1), prev = points.at(-2);
    const step = (a: any, b: any): number | null => {
      if (!a || !b || b.t - a.t !== 180000 || a.value === null || b.value === null || exactDte && (a.dte === null || b.dte !== a.dte || b.dte !== last?.dte)) return null;
      if (percentage) return a.value > 0 && b.value >= 0 ? (b.value / a.value - 1) * 100 : null;
      return b.value - a.value;
    };
    const delta = step(prev, last), prior: number[] = [];
    for (let i = 1; i < points.length - 1; i++) {
      const v = step(points[i - 1], points[i]);
      if (v !== null) prior.push(v);
    }
    const enough = prior.length >= 8, magnitude = delta === null ? null : Math.abs(delta);
    // Midrank handles ties; latest change is excluded from its own reference distribution.
    const rank = !enough || magnitude === null ? null : 100 * (prior.filter(v => Math.abs(v) < magnitude).length + 0.5 * prior.filter(v => Math.abs(v) === magnitude).length) / prior.length;
    return {field, label, unit, value: last?.value ?? null, delta, at: last ? new Date(last.t).toISOString() : null,
      from: prev ? new Date(prev.t).toISOString() : null, gapMinutes: last && prev ? (last.t - prev.t) / 60000 : null,
      samples: points.length, numericSamples: points.filter(p => p.value !== null).length,
      conflicts: points.filter(p => p.conflict).length, priorChanges: prior.length, percentile: rank,
      median: enough ? quantile(prior, 0.5) : null, q25: enough ? quantile(prior, 0.25) : null, q75: enough ? quantile(prior, 0.75) : null,
      status: delta === null ? 'INTERVAL_UNAVAILABLE' : enough ? 'DESCRIPTIVE_ONLY' : 'INSUFFICIENT_COMPARISONS',
      dte: exactDte ? last?.dte ?? null : null};
  };
  const options = (current.options || []).filter((r: any) => key(r) === contractKey);
  const chain = (current.chain || []).filter((r: any) => String(r.expiry).slice(0, 10) === expiry);
  return {symbol, expiry, contractKey, tradeDate, metrics: [
    series(current.market || [], 'spot_ltp', 'Spot', '%', true),
    series(chain, 'full_chain_oi_pcr', 'Full PCR', 'ratio points', false),
    series(options, 'ltp', 'Exact premium', '%', true, true),
    series(options, 'oi', 'Exact option OI', 'source OI units', false, true)
  ], definition: 'Latest exact 3-minute interval versus earlier same-session intervals. Premium/OI require the same recorded DTE and exact contract. Minimum 8 earlier changes is a display rule, not statistical significance. Percentile uses absolute-change midrank; median and middle 50% use signed changes. No imputation, prediction, correlation or profit probability. Missing source truth remains unverified; non-TRUE verdicts are excluded.'};
}

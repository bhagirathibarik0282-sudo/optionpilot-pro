export type WatchMetric =
  | "spot3m"
  | "future3m"
  | "cePremium3m"
  | "pePremium3m"
  | "ceOi3m"
  | "peOi3m"
  | "pcr3m"
  | "vix3m"
  | "ppd3m"
  | "spreadPct";

export interface WatchZInput {
  symbol: string;
  spot3m?: number | null;
  future3m?: number | null;
  cePremium3m?: number | null;
  pePremium3m?: number | null;
  ceOi3m?: number | null;
  peOi3m?: number | null;
  pcr3m?: number | null;
  vix3m?: number | null;
  ppd3m?: number | null;
  ppdSide?: "CE" | "PE" | null;
  spreadPct?: number | null;
}

export interface WatchZMetricResult {
  raw: number | null;
  z: number | null;
  sampleCount: number;
  ready: boolean;
}

export interface WatchZResult {
  ready: boolean;
  watchSide: "CE" | "PE" | null;
  directionalScore: number | null;
  metrics: Record<WatchMetric, WatchZMetricResult>;
  note: string;
}

const MIN_SAMPLES = 10;
const MAX_SAMPLES = 40;
const history = new Map<string, number[]>();

function finite(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function stats(xs: number[]) {
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const variance = xs.length > 1 ? xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length - 1) : 0;
  return { mean, sd: Math.sqrt(Math.max(variance, 0)) };
}

function updateMetric(symbol: string, metric: WatchMetric, rawValue: unknown): WatchZMetricResult {
  const raw = finite(rawValue);
  const key = `${symbol}:${metric}`;
  const prev = history.get(key) ?? [];
  let z: number | null = null;
  const ready = raw !== null && prev.length >= MIN_SAMPLES;
  if (ready) {
    const { mean, sd } = stats(prev);
    if (sd > 1e-9) z = (raw - mean) / sd;
  }
  if (raw !== null) history.set(key, [...prev, raw].slice(-MAX_SAMPLES));
  return { raw, z, sampleCount: prev.length, ready: ready && z !== null };
}

export function updateWatchZScore(input: WatchZInput): WatchZResult {
  const signedPpd = finite(input.ppd3m) === null
    ? null
    : input.ppdSide === "CE"
      ? Math.abs(Number(input.ppd3m))
      : input.ppdSide === "PE"
        ? -Math.abs(Number(input.ppd3m))
        : Number(input.ppd3m);

  const metrics: Record<WatchMetric, WatchZMetricResult> = {
    spot3m: updateMetric(input.symbol, "spot3m", input.spot3m),
    future3m: updateMetric(input.symbol, "future3m", input.future3m),
    cePremium3m: updateMetric(input.symbol, "cePremium3m", input.cePremium3m),
    pePremium3m: updateMetric(input.symbol, "pePremium3m", input.pePremium3m),
    ceOi3m: updateMetric(input.symbol, "ceOi3m", input.ceOi3m),
    peOi3m: updateMetric(input.symbol, "peOi3m", input.peOi3m),
    pcr3m: updateMetric(input.symbol, "pcr3m", input.pcr3m),
    vix3m: updateMetric(input.symbol, "vix3m", input.vix3m),
    ppd3m: updateMetric(input.symbol, "ppd3m", signedPpd),
    spreadPct: updateMetric(input.symbol, "spreadPct", input.spreadPct),
  };

  // Direction uses only metrics with defensible directional meaning.
  // OI, PCR, VIX and spread are normalized and displayed, but remain context/risk rather than directional votes.
  const directional: number[] = [];
  if (metrics.spot3m.ready && metrics.spot3m.z !== null) directional.push(metrics.spot3m.z);
  if (metrics.future3m.ready && metrics.future3m.z !== null) directional.push(metrics.future3m.z);
  if (metrics.cePremium3m.ready && metrics.cePremium3m.z !== null) directional.push(metrics.cePremium3m.z);
  if (metrics.pePremium3m.ready && metrics.pePremium3m.z !== null) directional.push(-metrics.pePremium3m.z);
  if (metrics.ppd3m.ready && metrics.ppd3m.z !== null) directional.push(metrics.ppd3m.z);

  const ready = directional.length >= 2;
  const directionalScore = ready ? directional.reduce((a, b) => a + b, 0) / directional.length : null;
  const watchSide = directionalScore === null ? null : directionalScore >= 0.75 ? "CE" : directionalScore <= -0.75 ? "PE" : null;
  const note = !ready
    ? `Z NOT READY: need at least ${MIN_SAMPLES} prior samples on 2+ directional metrics.`
    : watchSide
      ? `Z-managed ${watchSide} watch; mean directional Z ${directionalScore!.toFixed(2)}.`
      : `Z normalized, but directional pressure is not abnormal enough; mean Z ${directionalScore!.toFixed(2)}.`;
  return { ready, watchSide, directionalScore, metrics, note };
}

export function resetWatchZScoreForTests(): void {
  history.clear();
}

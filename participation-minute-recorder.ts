/** One compact archive per observed minute; no reads write and no raw ticks persist. */
export const PARTICIPATION_KIND = "DASHBOARD_PARTICIPATION_MINUTE_V1";
type Row = { token: number; label: string; role: "STOCK" | "SECTOR";
  price: number | null; pdc: number | null; changePct: number | null;
  observedAt: string | null; receivedAt: string | null; state: string };
export type ParticipationMinute = { version: typeof PARTICIPATION_KIND; memoryKey: string;
  tradeDate: string; minuteBucket: string; capturedAt: string; runtimeId: string; rows: Row[];
  coverage: { provided: number; live: number; diagnostic: number } };
function finite(x: unknown): x is number { return typeof x === "number" && Number.isFinite(x); }
function time(x: unknown): number | null {
  if (typeof x !== "string" || !/(?:Z|[+-]\d{2}:\d{2})$/.test(x)) return null;
  const t = Date.parse(x); return finite(t) ? t : null;
}
function day(t: number) { return new Date(t + 19_800_000).toISOString().slice(0,10); }
export function participationMinute(frame: any, now: number): ParticipationMinute | null {
  if (!finite(now) || frame?.connected !== true || frame?.source !== "KITE_WEBSOCKET_FULL") return null;
  const at = time(frame.serverTime), snapshot = frame.snapshot, asOf = time(snapshot?.asOf);
  if (at === null || asOf === null || Math.abs(now-at)>10_000 || now-asOf < -5000 || now-asOf>30_000
    || snapshot.tradeDate !== day(now) || typeof snapshot.runtimeId !== "string" || !snapshot.runtimeId
    || !Array.isArray(snapshot.participation) || !snapshot.participation.length) return null;
  const rows: Row[] = [], seen = new Set<string>();
  for (const q of snapshot.participation) {
    const id = q?.identity;
    if (!Number.isInteger(id?.token) || id.token <= 0 || typeof id.label !== "string" || !id.label
      || !["STOCK","SECTOR"].includes(id.role)) return null;
    const key = `${id.role}|${id.token}`;
    if (seen.has(key)) return null; seen.add(key);
    const observed = time(q.observedAt), received = time(q.receivedAt);
    const fresh = q.state === "LIVE" && observed !== null && received !== null
      && day(observed) === day(now) && day(received) === day(now)
      && now-observed >= -5000 && now-observed <= 60_000
      && now-received >= -5000 && now-received <= 60_000 && received-observed >= -5000;
    const price = finite(q.price) && q.price>0 ? q.price : null;
    const pdc = finite(q.pdc) && q.pdc>0 ? q.pdc : null;
    rows.push({token:id.token,label:id.label,role:id.role,price,pdc,
      changePct: price !== null && pdc !== null ? (price-pdc)/pdc*100 : null,
      observedAt:observed === null ? null : q.observedAt,
      receivedAt:received === null ? null : q.receivedAt,
      state:fresh && price !== null ? "LIVE" : "DIAGNOSTIC_STALE_OR_MISSING"});
  }
  const bucket = new Date(Math.floor(now/60_000)*60_000).toISOString();
  return {version:PARTICIPATION_KIND,memoryKey:bucket,tradeDate:day(now),minuteBucket:bucket,
    capturedAt:new Date(now).toISOString(),runtimeId:snapshot.runtimeId,rows,
    coverage:{provided:rows.length,live:rows.filter(r=>r.state==='LIVE').length,
      diagnostic:rows.filter(r=>r.state!=='LIVE').length}};
}
export function createParticipationMinuteRecorder(save:(p:ParticipationMinute)=>Promise<boolean>) {
  let busy = false, lastSaved = "";
  return {async capture(read:()=>unknown, now = Date.now()):Promise<string> {
    if (!finite(now)) return "SKIPPED";
    const key = new Date(Math.floor(now/60_000)*60_000).toISOString();
    if (busy || key <= lastSaved) return "SKIPPED";
    busy = true;
    try {
      const payload = participationMinute(read(),now); if (!payload) return "SKIPPED";
      const inserted = await save(payload); lastSaved = key;
      return inserted ? "SAVED" : "ALREADY_RECORDED";
    } catch { return "FAILED"; } finally { busy = false; }
  }};
}

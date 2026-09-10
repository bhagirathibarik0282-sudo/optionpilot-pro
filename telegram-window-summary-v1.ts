export type SummaryDirection = "BULLISH" | "BEARISH" | "MIXED" | "NEUTRAL" | "NOT_READY";
export type SummaryWindow = 3 | 6 | 15 | 30 | 60;
export interface WindowEvidence { windowMinutes: SummaryWindow; spotChange?: number | null; futureChange?: number | null; pcrChange?: number | null; vixChange?: number | null; cePremiumChangePct?: number | null; pePremiumChangePct?: number | null; ppdSide?: "CE" | "PE" | null; ppdValuePp?: number | null; callWallStrengthChange?: number | null; putWallStrengthChange?: number | null; heavyweightUp?: number | null; heavyweightDown?: number | null; }
export interface WindowSummary { windowMinutes: SummaryWindow; direction: SummaryDirection; text: string; evidenceCount: number; }
const LABEL: Record<SummaryWindow,string> = {3:"3M",6:"6M",15:"15M",30:"30M",60:"1H"};
const ROLE: Record<SummaryWindow,string> = {3:"early clue",6:"confirmation",15:"transition validation",30:"sustained behaviour",60:"regime"};
function sign(v: number | null | undefined): number { return typeof v === "number" && Number.isFinite(v) ? (v > 0 ? 1 : v < 0 ? -1 : 0) : 0; }
export function buildWindowSummary(e: WindowEvidence): WindowSummary {
  const votes: number[] = [];
  if (Number.isFinite(e.spotChange)) votes.push(sign(e.spotChange));
  if (Number.isFinite(e.futureChange)) votes.push(sign(e.futureChange));
  if (Number.isFinite(e.cePremiumChangePct) || Number.isFinite(e.pePremiumChangePct)) { const ce=Number.isFinite(e.cePremiumChangePct)?Number(e.cePremiumChangePct):0; const pe=Number.isFinite(e.pePremiumChangePct)?Number(e.pePremiumChangePct):0; votes.push(sign(ce-pe)); }
  if (e.ppdSide === "CE") votes.push(1); if (e.ppdSide === "PE") votes.push(-1);
  if (Number.isFinite(e.callWallStrengthChange) || Number.isFinite(e.putWallStrengthChange)) { const c=Number.isFinite(e.callWallStrengthChange)?Number(e.callWallStrengthChange):0; const p=Number.isFinite(e.putWallStrengthChange)?Number(e.putWallStrengthChange):0; votes.push(sign(p-c)); }
  if (Number.isFinite(e.heavyweightUp) && Number.isFinite(e.heavyweightDown)) votes.push(sign(Number(e.heavyweightUp)-Number(e.heavyweightDown)));
  const useful=votes.filter(v=>v!==0); if (votes.length<2 || useful.length===0) return {windowMinutes:e.windowMinutes,direction:"NOT_READY",evidenceCount:votes.length,text:`${LABEL[e.windowMinutes]} SUMMARY: Not enough verified change yet — WAIT.`};
  const score=useful.reduce((a,b)=>a+b,0); const direction:SummaryDirection=score>=2?"BULLISH":score<=-2?"BEARISH":useful.some(v=>v>0)&&useful.some(v=>v<0)?"MIXED":"NEUTRAL";
  const phrase=direction==="BULLISH"?"Bullish pressure":direction==="BEARISH"?"Bearish pressure":direction==="MIXED"?"Mixed transition":"No clear control";
  return {windowMinutes:e.windowMinutes,direction,evidenceCount:votes.length,text:`${LABEL[e.windowMinutes]} SUMMARY: ${phrase} (${ROLE[e.windowMinutes]}). ${useful.length}/${votes.length} directional evidence items active.`};
}
export interface EodBehaviourInput { symbol:string; summaries:WindowSummary[]; opening?:string|null; morning?:string|null; midday?:string|null; afternoon?:string|null; close?:string|null; }
export function buildEodBehaviourSummary(input:EodBehaviourInput):string { const usable=input.summaries.filter(x=>x.direction!=="NOT_READY"); const bull=usable.filter(x=>x.direction==="BULLISH").length; const bear=usable.filter(x=>x.direction==="BEARISH").length; const regime=bull>bear?"BULLISH":bear>bull?"BEARISH":"MIXED"; const phase=(n:string,v?:string|null)=>`${n}: ${v?.trim()||"—"}`; return [`📘 OPTIONPILOT EOD MARKET BEHAVIOUR • ${input.symbol}`,phase("Opening",input.opening),phase("Morning",input.morning),phase("Midday",input.midday),phase("Afternoon",input.afternoon),phase("Close",input.close),`Window verdicts: ${input.summaries.map(x=>`${LABEL[x.windowMinutes]} ${x.direction}`).join(" | ")||"—"}`,`FINAL DAY BEHAVIOUR: ${regime}`,"Research summary only • selector/execution authority unchanged."].join("\n"); }

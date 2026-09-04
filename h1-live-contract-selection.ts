import type { KiteInstrumentMasterRow } from "./kite-immediate-registry-builder.js";
import type { RecorderSymbol } from "./option-recorder-shadow.js";
import type { H1LiveSelectionSpotRow } from "./h1-live-selection-spot-rest.js";

export interface H1LiveSelectedContractPeerPair {
  expiry: string;
  strike: number;
  ceInstrumentToken: number;
  peInstrumentToken: number;
  ceTradingsymbol: string;
  peTradingsymbol: string;
}

export interface H1LiveSelectedContractPair extends H1LiveSelectedContractPeerPair {
  symbol: RecorderSymbol;
  spot: number;
  peerPairs: H1LiveSelectedContractPeerPair[];
}

export interface H1LiveContractSelectionResult {
  version: "H1_LIVE_CONTRACT_SELECTION_V1";
  ready: boolean;
  rows: H1LiveSelectedContractPair[];
  blockers: string[];
  source: "KITE_MASTER_PLUS_REST_SPOT_SELECTION_ONLY";
  productionImpact: "NONE";
  affectsDirection: false;
  affectsVerdict: false;
  affectsExecution: false;
  affectsTelegram: false;
  activatesShadow: false;
  infersTokens: false;
  failClosed: true;
}

function out(ready:boolean, rows:H1LiveSelectedContractPair[], blockers:string[]):H1LiveContractSelectionResult {
  return { version:"H1_LIVE_CONTRACT_SELECTION_V1", ready, rows:ready?rows:[], blockers:[...new Set(blockers)], source:"KITE_MASTER_PLUS_REST_SPOT_SELECTION_ONLY", productionImpact:"NONE", affectsDirection:false, affectsVerdict:false, affectsExecution:false, affectsTelegram:false, activatesShadow:false, infersTokens:false, failClosed:true };
}

function normalizedName(row: KiteInstrumentMasterRow): string { return `${row.name || ""} ${row.tradingsymbol || ""}`.toUpperCase(); }
function matches(row: KiteInstrumentMasterRow, symbol: RecorderSymbol): boolean {
  const text=normalizedName(row);
  if(symbol==="NIFTY") return text.includes("NIFTY")&&!text.includes("BANKNIFTY")&&!text.includes("FINNIFTY")&&!text.includes("NIFTY BANK");
  if(symbol==="BANKNIFTY") return text.includes("BANKNIFTY")||text.includes("NIFTY BANK");
  return text.includes(symbol);
}

function nearestCommonPair(optionRows:KiteInstrumentMasterRow[], expiry:string, spot:number):H1LiveSelectedContractPeerPair|null {
  const byStrike=new Map<number,{ce?:KiteInstrumentMasterRow;pe?:KiteInstrumentMasterRow}>();
  for(const r of optionRows.filter((x)=>String(x.expiry)===expiry)){
    const strike=Number(r.strike); const item=byStrike.get(strike)||{};
    if(r.instrument_type==="CE") item.ce=r; else if(r.instrument_type==="PE") item.pe=r;
    byStrike.set(strike,item);
  }
  const common=[...byStrike.entries()].filter(([,v])=>v.ce&&v.pe).map(([strike])=>strike).sort((a,b)=>a-b);
  if(common.length===0) return null;
  let strike=common[0];
  for(const candidate of common){
    const d=Math.abs(candidate-spot), best=Math.abs(strike-spot);
    if(d<best || (d===best && candidate<strike)) strike=candidate;
  }
  const pair=byStrike.get(strike)!;
  return { expiry, strike, ceInstrumentToken:pair.ce!.instrument_token, peInstrumentToken:pair.pe!.instrument_token, ceTradingsymbol:pair.ce!.tradingsymbol, peTradingsymbol:pair.pe!.tradingsymbol };
}

export function selectH1LiveContracts(rows:KiteInstrumentMasterRow[], spots:H1LiveSelectionSpotRow[], asOfDate:string):H1LiveContractSelectionResult {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(asOfDate)) return out(false,[],["AS_OF_DATE_INVALID"]);
  const selected:H1LiveSelectedContractPair[]=[];
  for(const spot of spots){
    const optionRows=rows.filter((r)=>matches(r,spot.symbol)&&/^\d{4}-\d{2}-\d{2}$/.test(String(r.expiry||""))&&String(r.expiry)>=asOfDate&&(String(r.instrument_type)==="CE"||String(r.instrument_type)==="PE")&&Number.isFinite(Number(r.strike))&&Number(r.strike)>0&&Number.isInteger(r.instrument_token));
    const expiries=[...new Set(optionRows.map((r)=>String(r.expiry)))].sort();
    if(expiries.length===0) return out(false,[],[`NO_NON_EXPIRED_OPTIONS:${spot.symbol}`]);

    const primary=nearestCommonPair(optionRows,expiries[0],spot.ltp);
    if(!primary) return out(false,[],[`NO_COMMON_CE_PE_STRIKE:${spot.symbol}:${expiries[0]}`]);

    const peerPairs:H1LiveSelectedContractPeerPair[]=[];
    for(const expiry of expiries.slice(1)){
      const peer=nearestCommonPair(optionRows,expiry,spot.ltp);
      if(peer) peerPairs.push(peer);
      if(peerPairs.length===2) break;
    }

    selected.push({ symbol:spot.symbol, spot:spot.ltp, ...primary, peerPairs });
  }
  return out(true,selected,[]);
}

import { resolveKiteAuthoritySession } from "./kite-session-authority.js";
import { fetchH1KiteLiveInstrumentMaster } from "./h1-kite-live-instrument-master-adapter.js";
import { fetchH1LiveSelectionSpots, type H1LiveSelectionSpotResult } from "./h1-live-selection-spot-rest.js";
import { selectH1LiveContracts, type H1LiveContractSelectionResult } from "./h1-live-contract-selection.js";

export interface H1LiveContractSelectionStartupEvidence {
  selection: H1LiveContractSelectionResult;
  spots: H1LiveSelectionSpotResult;
  productionImpact: "NONE";
  affectsVerdict: false;
  affectsExecution: false;
  affectsTelegram: false;
  failClosed: true;
}

export async function runH1LiveContractSelectionStartupEvidence(asOfDate:string): Promise<H1LiveContractSelectionStartupEvidence> {
  const apiKey=process.env.KITE_API_KEY?.trim()||"";
  const authority=await resolveKiteAuthoritySession();
  if(!apiKey||!authority.session||!authority.status.active) throw new Error(!apiKey?"KITE_API_KEY_MISSING":`KITE_AUTHORITY_${authority.status.code}`);
  const master=await fetchH1KiteLiveInstrumentMaster({apiKey,accessToken:authority.session.accessToken});
  if(!master.ready) throw new Error(master.blockers.join("|"));
  const spots=await fetchH1LiveSelectionSpots({rows:master.rows,symbols:["NIFTY","SENSEX","BANKNIFTY"],apiKey,accessToken:authority.session.accessToken});
  if(!spots.ready){
    const candidates=master.rows
      .filter((row)=>String(row.segment||"").toUpperCase().includes("INDICES"))
      .filter((row)=>{
        const text=`${row.name||""} ${row.tradingsymbol||""}`.toUpperCase();
        return text.includes("NIFTY")||text.includes("SENSEX");
      })
      .map((row)=>({tradingsymbol:row.tradingsymbol,name:row.name??null,exchange:row.exchange??null,segment:row.segment??null,instrumentType:row.instrument_type??null}))
      .slice(0,200);
    console.log(`[H1_LIVE_SPOT_CANDIDATE_DIAGNOSTIC] ${JSON.stringify({ready:false,productionImpact:"NONE",candidateCount:candidates.length,candidates,credentialsExposed:false,writesRailwayVariables:false,activatesShadow:false,affectsVerdict:false,affectsExecution:false,affectsTelegram:false})}`);
    throw new Error(spots.blockers.join("|"));
  }
  const selection=selectH1LiveContracts(master.rows,spots.rows,asOfDate);
  return {selection,spots,productionImpact:"NONE",affectsVerdict:false,affectsExecution:false,affectsTelegram:false,failClosed:true};
}

export async function runH1LiveContractSelectionStartupAudit(asOfDate:string){
  const evidence=await runH1LiveContractSelectionStartupEvidence(asOfDate);
  return evidence.selection;
}

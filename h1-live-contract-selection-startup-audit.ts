import { resolveKiteAuthoritySession } from "./kite-session-authority.js";
import { fetchH1KiteLiveInstrumentMaster } from "./h1-kite-live-instrument-master-adapter.js";
import { fetchH1LiveSelectionSpots } from "./h1-live-selection-spot-rest.js";
import { selectH1LiveContracts } from "./h1-live-contract-selection.js";

async function main(){
  const asOfDate=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Kolkata",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
  const apiKey=process.env.KITE_API_KEY?.trim()||"";
  const authority=await resolveKiteAuthoritySession();
  if(!apiKey||!authority.session||!authority.status.active) throw new Error(!apiKey?"KITE_API_KEY_MISSING":`KITE_AUTHORITY_${authority.status.code}`);
  const master=await fetchH1KiteLiveInstrumentMaster({apiKey,accessToken:authority.session.accessToken});
  if(!master.ready) throw new Error(master.blockers.join("|"));
  const spots=await fetchH1LiveSelectionSpots({rows:master.rows,symbols:["NIFTY","SENSEX","BANKNIFTY"],apiKey,accessToken:authority.session.accessToken});
  if(!spots.ready) throw new Error(spots.blockers.join("|"));
  const selected=selectH1LiveContracts(master.rows,spots.rows,asOfDate);
  console.log(`[H1_LIVE_CONTRACT_SELECTION_STARTUP_AUDIT] ${JSON.stringify(selected)}`);
}

main().catch((err)=>console.error(`[H1_LIVE_CONTRACT_SELECTION_STARTUP_AUDIT] ${JSON.stringify({version:"H1_LIVE_CONTRACT_SELECTION_V1",ready:false,rows:[],blockers:[err instanceof Error?err.message:"STARTUP_AUDIT_FAILED"],source:"KITE_MASTER_PLUS_REST_SPOT_SELECTION_ONLY",productionImpact:"NONE",affectsDirection:false,affectsVerdict:false,affectsExecution:false,affectsTelegram:false,activatesShadow:false,infersTokens:false,failClosed:true})}`));

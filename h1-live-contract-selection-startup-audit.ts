import { resolveKiteAuthoritySession } from "./kite-session-authority.js";
import { fetchH1KiteLiveInstrumentMaster } from "./h1-kite-live-instrument-master-adapter.js";
import { fetchH1LiveSelectionSpots } from "./h1-live-selection-spot-rest.js";
import { selectH1LiveContracts } from "./h1-live-contract-selection.js";

export async function runH1LiveContractSelectionStartupAudit(asOfDate:string){
  const apiKey=process.env.KITE_API_KEY?.trim()||"";
  const authority=await resolveKiteAuthoritySession();
  if(!apiKey||!authority.session||!authority.status.active) throw new Error(!apiKey?"KITE_API_KEY_MISSING":`KITE_AUTHORITY_${authority.status.code}`);
  const master=await fetchH1KiteLiveInstrumentMaster({apiKey,accessToken:authority.session.accessToken});
  if(!master.ready) throw new Error(master.blockers.join("|"));
  const spots=await fetchH1LiveSelectionSpots({rows:master.rows,symbols:["NIFTY","SENSEX","BANKNIFTY"],apiKey,accessToken:authority.session.accessToken});
  if(!spots.ready) throw new Error(spots.blockers.join("|"));
  return selectH1LiveContracts(master.rows,spots.rows,asOfDate);
}

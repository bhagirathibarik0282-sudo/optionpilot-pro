import { runH1LiveContractSelectionStartupEvidence } from "./h1-live-contract-selection-startup-audit.js";
import { preflightH1LiveSelectionIntoExactRegistry } from "./h1-live-selection-exact-registry-preflight.js";
import { prepareH1LiveExactMarketWiring } from "./h1-live-exact-market-wiring-readiness.js";
import { H1LiveExactReadOnlyWebSocketService } from "./h1-live-exact-readonly-websocket-service.js";
import { KiteImmediateTokenRegistry, type KiteImmediateTokenEntry } from "./kite-immediate-token-registry.js";
import { resolveKiteAuthoritySession } from "./kite-session-authority.js";

export interface H1DynamicReadOnlyLiveStartResult {
  version: "H1_DYNAMIC_READONLY_LIVE_CHAIN_V1";
  started: boolean;
  reason: "DISABLED" | "STARTED" | "AUTHORITY_UNAVAILABLE" | "PREPARATION_BLOCKED";
  subscribedTokenCount: number;
  productionImpact: "NONE";
  readOnly: true;
  affectsDirection: false;
  affectsVerdict: false;
  affectsExecution: false;
  affectsTelegram: false;
  failClosed: true;
  service: H1LiveExactReadOnlyWebSocketService | null;
}

function result(started:boolean, reason:H1DynamicReadOnlyLiveStartResult["reason"], subscribedTokenCount=0, service:H1LiveExactReadOnlyWebSocketService|null=null): H1DynamicReadOnlyLiveStartResult {
  return {version:"H1_DYNAMIC_READONLY_LIVE_CHAIN_V1",started,reason,subscribedTokenCount,productionImpact:"NONE",readOnly:true,affectsDirection:false,affectsVerdict:false,affectsExecution:false,affectsTelegram:false,failClosed:true,service};
}

export async function startH1DynamicReadOnlyLiveChain(asOfDate:string, enabled:boolean): Promise<H1DynamicReadOnlyLiveStartResult> {
  if(!enabled) return result(false,"DISABLED");
  try {
    const evidence=await runH1LiveContractSelectionStartupEvidence(asOfDate);
    if(!evidence.selection.ready || !evidence.spots.ready) return result(false,"PREPARATION_BLOCKED");

    const spotEntries:KiteImmediateTokenEntry[]=evidence.spots.rows.map((row)=>({
      instrumentToken:row.instrumentToken,
      symbol:row.symbol,
      role:"SPOT",
      instrumentLabel:row.tradingsymbol,
    }));
    const baseRegistry=new KiteImmediateTokenRegistry(spotEntries);
    const preflight=preflightH1LiveSelectionIntoExactRegistry(baseRegistry,evidence.selection);
    if(!preflight.ready) return result(false,"PREPARATION_BLOCKED");
    const readiness=prepareH1LiveExactMarketWiring(evidence.selection,preflight);
    if(!readiness.ready || !readiness.registry) return result(false,"PREPARATION_BLOCKED");

    const apiKey=process.env.KITE_API_KEY?.trim()||"";
    const authority=await resolveKiteAuthoritySession();
    if(!apiKey||!authority.session||!authority.status.active) return result(false,"AUTHORITY_UNAVAILABLE");

    const service=new H1LiveExactReadOnlyWebSocketService({
      readiness,
      apiKey,
      accessToken:authority.session.accessToken,
    });
    const status=service.start();
    return result(true,"STARTED",status.subscribedTokenCount,service);
  } catch {
    return result(false,"PREPARATION_BLOCKED");
  }
}

import { runH1LiveContractSelectionStartupEvidence } from "./h1-live-contract-selection-startup-audit.js";
import { preflightH1LiveSelectionIntoExactRegistry } from "./h1-live-selection-exact-registry-preflight.js";
import { prepareH1LiveExactMarketWiring } from "./h1-live-exact-market-wiring-readiness.js";
import { H1LiveExactReadOnlyWebSocketService } from "./h1-live-exact-readonly-websocket-service.js";
import { buildH1SelectorCanonicalValidationHandoffV1 } from "./h1-selector-canonical-validation-handoff-v1.js";
import { KiteImmediateTokenRegistry, type KiteImmediateTokenEntry } from "./kite-immediate-token-registry.js";
import { resolveKiteAuthoritySession } from "./kite-session-authority.js";
import { installSweetSpotLiveObserver } from "./sweet-spot-live-observer-v1.js";

export interface H1DynamicReadOnlyLiveStartResult {
  version: "H1_DYNAMIC_READONLY_LIVE_CHAIN_V1";
  started: boolean;
  reason: "DISABLED" | "STARTED" | "AUTHORITY_UNAVAILABLE" | "PREPARATION_BLOCKED";
  subscribedTokenCount: number;
  constituentRegistryReady: boolean;
  constituentTokenCount: number;
  constituentBlockers: string[];
  productionImpact: "NONE";
  readOnly: true;
  affectsDirection: false;
  affectsVerdict: false;
  affectsExecution: false;
  affectsTelegram: false;
  failClosed: true;
  service: H1LiveExactReadOnlyWebSocketService | null;
}

function result(started:boolean,reason:H1DynamicReadOnlyLiveStartResult["reason"],subscribedTokenCount=0,service:H1LiveExactReadOnlyWebSocketService|null=null,constituentRegistryReady=false,constituentTokenCount=0,constituentBlockers:string[]=[]): H1DynamicReadOnlyLiveStartResult {
  return {version:"H1_DYNAMIC_READONLY_LIVE_CHAIN_V1",started,reason,subscribedTokenCount,constituentRegistryReady,constituentTokenCount,constituentBlockers:[...constituentBlockers],productionImpact:"NONE",readOnly:true,affectsDirection:false,affectsVerdict:false,affectsExecution:false,affectsTelegram:false,failClosed:true,service};
}

export async function startH1DynamicReadOnlyLiveChain(asOfDate:string, enabled:boolean): Promise<H1DynamicReadOnlyLiveStartResult> {
  if(!enabled) return result(false,"DISABLED");
  try {
    const evidence=await runH1LiveContractSelectionStartupEvidence(asOfDate);
    if(!evidence.selection.ready || !evidence.spots.ready) return result(false,"PREPARATION_BLOCKED");
    const spotEntries:KiteImmediateTokenEntry[]=evidence.spots.rows.map((row)=>({instrumentToken:row.instrumentToken,symbol:row.symbol,role:"SPOT",instrumentLabel:row.tradingsymbol}));
    const baseRegistry=new KiteImmediateTokenRegistry(spotEntries);
    const preflight=preflightH1LiveSelectionIntoExactRegistry(baseRegistry,evidence.selection);
    if(!preflight.ready) return result(false,"PREPARATION_BLOCKED");
    const readiness=prepareH1LiveExactMarketWiring(evidence.selection,preflight);
    if(!readiness.ready || !readiness.registry) return result(false,"PREPARATION_BLOCKED");
    const apiKey=process.env.KITE_API_KEY?.trim()||"";
    const authority=await resolveKiteAuthoritySession();
    if(!apiKey||!authority.session||!authority.status.active) return result(false,"AUTHORITY_UNAVAILABLE");
    installSweetSpotLiveObserver(readiness.registry.entries());
    let selectorPolicyValidation;
    if (process.env.KITE_H1_EXACT_POLICY_JSON?.trim()) {
      try {
        const handoff = await buildH1SelectorCanonicalValidationHandoffV1();
        selectorPolicyValidation = handoff.proof;
        console.log(`[H1_SELECTOR_CANONICAL_VALIDATION_HANDOFF] ${JSON.stringify({
          version: handoff.version,
          readyForCanonicalPolicySource: handoff.readyForCanonicalPolicySource,
          blockers: handoff.blockers,
          source: handoff.source,
          productionImpact: handoff.productionImpact,
          createsOrders: handoff.createsOrders,
          failClosed: handoff.failClosed,
        })}`);
      } catch {
        console.warn(`[H1_SELECTOR_CANONICAL_VALIDATION_HANDOFF] ${JSON.stringify({
          version: "H1_SELECTOR_CANONICAL_VALIDATION_HANDOFF_V1",
          readyForCanonicalPolicySource: false,
          blockers: ["VALIDATION_HANDOFF_READ_FAILED"],
          source: "NONE",
          productionImpact: "NONE",
          createsOrders: false,
          failClosed: true,
        })}`);
      }
    }
    const service=new H1LiveExactReadOnlyWebSocketService({
      readiness,
      apiKey,
      accessToken:authority.session.accessToken,
      constituentRegistry:evidence.constituents.ready ? evidence.constituents.registry : undefined,
      selectorPolicyValidation,
    });
    const status=service.start();
    return result(true,"STARTED",status.subscribedTokenCount,service,evidence.constituents.ready,evidence.constituents.registry.length,evidence.constituents.blockers);
  } catch (err) {
    console.warn(`[TELEGRAM_SWEET_SPOT] ${JSON.stringify({state:"ARM_FAILED",error:err instanceof Error?err.message:String(err),createsOrders:false})}`);
    return result(false,"PREPARATION_BLOCKED");
  }
}

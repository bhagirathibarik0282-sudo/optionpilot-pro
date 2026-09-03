export type Exchange = "NSE" | "BSE";
export type QuoteQuality = "VERIFIED" | "PROXY" | "DEGRADED" | "STALE" | "UNKNOWN";
export type BrokerageAccountState = "NON_DEBIT" | "DEBIT" | "UNKNOWN";

export interface ExecutableOptionQuote { bid:number|null; ask:number|null; quality:QuoteQuality; }
export interface OptionBuyerNetPayoffInput { exchange:Exchange; quantity:number; accountState:BrokerageAccountState; entry:ExecutableOptionQuote; exit:ExecutableOptionQuote; }
export interface OptionBuyerNetPayoffResult {
  state:"USABLE"|"UNAVAILABLE"; entryAsk:number|null; exitBid:number|null; grossPnl:number|null; brokerage:number|null; stt:number|null;
  transactionCharges:number|null; sebiCharges:number|null; stampDuty:number|null; gst:number|null; estimatedTotalCharges:number|null;
  estimatedNetPnl:number|null; estimatedNetReturnPctOnPremium:number|null; observedCostDragPct:number|null; blockers:string[];
  ruleVersion:"OPTION_BUYER_NET_PAYOFF_RESEARCH_V1"; semantics:"RESEARCH_ONLY";
  executionPricePolicy:"BUY_AT_VERIFIED_ASK_SELL_AT_VERIFIED_BID";
  ratePolicy:"ZERODHA_RETAIL_OPTIONS_RATES_VERIFIED_2026_09_03";
  costPrecisionPolicy:"ESTIMATE_NOT_CONTRACT_NOTE_EXACT";
  marketImpactPolicy:"UNMODELED_NO_SYNTHETIC_SLIPPAGE";
  affectsVerdict:false; affectsTelegram:false; affectsExecution:false; createsOrders:false; aiMayOverride:false;
}

const STT_SELL=0.0015, NSE_TXN=0.0003553, BSE_TXN=0.000325, SEBI=10/100_000_000, STAMP_BUY=0.00003, GST=0.18;
const finitePositive=(v:unknown):v is number=>typeof v==="number"&&Number.isFinite(v)&&v>0;
const verified=(q:QuoteQuality)=>q==="VERIFIED";

export function deriveOptionBuyerNetPayoffResearch(input:OptionBuyerNetPayoffInput):OptionBuyerNetPayoffResult{
 const blockers:string[]=[];
 if(!(input.exchange==="NSE"||input.exchange==="BSE")) blockers.push("UNSUPPORTED_EXCHANGE");
 if(!Number.isInteger(input.quantity)||input.quantity<=0) blockers.push("INVALID_QUANTITY");
 if(input.accountState==="UNKNOWN") blockers.push("BROKERAGE_ACCOUNT_STATE_UNKNOWN");
 if(!verified(input.entry.quality)||!verified(input.exit.quality)) blockers.push("QUOTE_NOT_VERIFIED");
 if(!finitePositive(input.entry.ask)) blockers.push("ENTRY_ASK_UNAVAILABLE");
 if(!finitePositive(input.exit.bid)) blockers.push("EXIT_BID_UNAVAILABLE");
 if(finitePositive(input.entry.bid)&&finitePositive(input.entry.ask)&&input.entry.bid>input.entry.ask) blockers.push("ENTRY_CROSSED_MARKET");
 if(finitePositive(input.exit.bid)&&finitePositive(input.exit.ask)&&input.exit.bid>input.exit.ask) blockers.push("EXIT_CROSSED_MARKET");
 const common={ruleVersion:"OPTION_BUYER_NET_PAYOFF_RESEARCH_V1" as const,semantics:"RESEARCH_ONLY" as const,executionPricePolicy:"BUY_AT_VERIFIED_ASK_SELL_AT_VERIFIED_BID" as const,ratePolicy:"ZERODHA_RETAIL_OPTIONS_RATES_VERIFIED_2026_09_03" as const,costPrecisionPolicy:"ESTIMATE_NOT_CONTRACT_NOTE_EXACT" as const,marketImpactPolicy:"UNMODELED_NO_SYNTHETIC_SLIPPAGE" as const,affectsVerdict:false as const,affectsTelegram:false as const,affectsExecution:false as const,createsOrders:false as const,aiMayOverride:false as const};
 if(blockers.length)return{state:"UNAVAILABLE",entryAsk:null,exitBid:null,grossPnl:null,brokerage:null,stt:null,transactionCharges:null,sebiCharges:null,stampDuty:null,gst:null,estimatedTotalCharges:null,estimatedNetPnl:null,estimatedNetReturnPctOnPremium:null,observedCostDragPct:null,blockers:[...new Set(blockers)],...common};
 const entryAsk=input.entry.ask as number,exitBid=input.exit.bid as number,qty=input.quantity;
 const buyPremium=entryAsk*qty,sellPremium=exitBid*qty,turnover=buyPremium+sellPremium,grossPnl=sellPremium-buyPremium;
 const brokeragePerOrder=input.accountState==="DEBIT"?40:20;
 const brokerage=brokeragePerOrder*2;
 const stt=Math.round(sellPremium*STT_SELL);
 const transactionCharges=turnover*(input.exchange==="NSE"?NSE_TXN:BSE_TXN);
 const sebiCharges=turnover*SEBI,stampDuty=buyPremium*STAMP_BUY,gst=(brokerage+sebiCharges+transactionCharges)*GST;
 const estimatedTotalCharges=brokerage+stt+transactionCharges+sebiCharges+stampDuty+gst;
 const estimatedNetPnl=grossPnl-estimatedTotalCharges;
 const estimatedNetReturnPctOnPremium=(estimatedNetPnl/buyPremium)*100;
 const observedCostDragPct=(estimatedTotalCharges/buyPremium)*100;
 return{state:"USABLE",entryAsk,exitBid,grossPnl,brokerage,stt,transactionCharges,sebiCharges,stampDuty,gst,estimatedTotalCharges,estimatedNetPnl,estimatedNetReturnPctOnPremium,observedCostDragPct,blockers:[],...common};
}

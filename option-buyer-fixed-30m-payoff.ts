import { selectExecutionCandidate, type ExecutionCandidateInput } from "./execution-candidate-selector.js";
import { deriveOptionBuyerNetPayoffResearch, type OptionBuyerNetPayoffInput, type QuoteQuality } from "./option-buyer-net-payoff-research.js";

export interface ExecutableQuotePoint {
  ts: string;
  expiryDate: string;
  strike: number;
  side: "CE" | "PE";
  bid: number | null;
  ask: number | null;
  quality: QuoteQuality;
}

export interface Fixed30mPayoffInput {
  signalTs: string;
  candidate: ExecutionCandidateInput;
  entryQuote: ExecutableQuotePoint;
  futureQuotes: ExecutableQuotePoint[];
  exchange: "NSE" | "BSE";
  quantity: number;
  accountState: "NON_DEBIT" | "DEBIT" | "UNKNOWN";
  evaluationDate: string;
}

export interface Fixed30mPayoffResult {
  state: "USABLE" | "UNAVAILABLE";
  targetTs: string | null;
  observedTs: string | null;
  candidateKey: string | null;
  estimatedNetPnl: number | null;
  estimatedNetReturnPctOnPremium: number | null;
  estimatedTotalCharges: number | null;
  blockers: string[];
  ruleVersion: "OPTION_BUYER_FIXED_30M_PAYOFF_V1";
  horizonPolicy: "EXACT_PLUS_30_MINUTES_NO_NEAREST_SUBSTITUTION";
  contractPolicy: "SELECTOR_QUALIFIED_SAME_CONTRACT_ENTRY_AND_EXIT_ONLY";
  executionPricePolicy: "BUY_AT_VERIFIED_ASK_SELL_AT_VERIFIED_BID";
  semantics: "RESEARCH_ONLY_COMPARABLE_30M_NET_PAYOFF_ESTIMATE";
  affectsVerdict: false;
  affectsTelegram: false;
  affectsExecution: false;
  createsOrders: false;
  aiMayOverride: false;
}

const parseMs=(ts:string)=>{const ms=Date.parse(ts);return Number.isFinite(ms)?ms:null;};
const istDate=(ms:number|null)=>ms==null?null:new Date(ms+330*60_000).toISOString().slice(0,10);

export function validateFixed30mOptionBuyerPayoff(input: Fixed30mPayoffInput): Fixed30mPayoffResult {
  const blockers:string[]=[];
  const signalMs=parseMs(input.signalTs);
  const targetMs=signalMs==null?null:signalMs+30*60_000;
  const targetTs=targetMs==null?null:new Date(targetMs).toISOString();
  const selection=selectExecutionCandidate(input.candidate);
  if(selection.decision!=="SELECT") blockers.push("OPTION_BUYER_CANDIDATE_NOT_SELECTOR_QUALIFIED");
  if(signalMs==null) blockers.push("INVALID_SIGNAL_TIMESTAMP");
  if(targetMs!=null&&istDate(targetMs)!==istDate(signalMs)) blockers.push("EXACT_30M_HORIZON_CROSSES_IST_SESSION");
  if(parseMs(input.entryQuote.ts)!==signalMs) blockers.push("ENTRY_QUOTE_NOT_BOUND_TO_SIGNAL_TIMESTAMP");
  if(input.entryQuote.side!==input.candidate.side||input.entryQuote.strike!==input.candidate.strike||input.entryQuote.expiryDate!==input.candidate.expiryDate) blockers.push("ENTRY_QUOTE_NOT_BOUND_TO_SELECTED_CONTRACT");
  if(input.entryQuote.quality!=="VERIFIED") blockers.push("ENTRY_QUOTE_NOT_VERIFIED");
  if(typeof input.entryQuote.ask!=="number"||!Number.isFinite(input.entryQuote.ask)||input.entryQuote.ask<=0) blockers.push("ENTRY_ASK_UNAVAILABLE");

  const exact=targetMs==null?[]:input.futureQuotes.filter(q=>parseMs(q.ts)===targetMs&&q.side===input.candidate.side&&q.strike===input.candidate.strike&&q.expiryDate===input.candidate.expiryDate);
  if(exact.length===0) blockers.push("EXACT_30M_EXIT_QUOTE_UNAVAILABLE");
  if(exact.length>1) blockers.push("DUPLICATE_EXACT_30M_EXIT_QUOTES");
  const exit=exact.length===1?exact[0]:null;
  if(exit&&exit.quality!=="VERIFIED") blockers.push("EXIT_QUOTE_NOT_VERIFIED");
  if(exit&&(typeof exit.bid!=="number"||!Number.isFinite(exit.bid)||exit.bid<=0)) blockers.push("EXIT_BID_UNAVAILABLE");
  if(exit&&istDate(parseMs(exit.ts))!==istDate(signalMs)) blockers.push("EXIT_QUOTE_OUTSIDE_SIGNAL_IST_SESSION");

  let estimatedNetPnl:number|null=null,estimatedNetReturnPctOnPremium:number|null=null,estimatedTotalCharges:number|null=null;
  if(blockers.length===0&&exit){
    const netInput:OptionBuyerNetPayoffInput={exchange:input.exchange,quantity:input.quantity,accountState:input.accountState,evaluationDate:input.evaluationDate,entry:{bid:input.entryQuote.bid,ask:input.entryQuote.ask,quality:input.entryQuote.quality},exit:{bid:exit.bid,ask:exit.ask,quality:exit.quality}};
    const net=deriveOptionBuyerNetPayoffResearch(netInput);
    if(net.state!=="USABLE") blockers.push(...net.blockers.map(x=>`NET_PAYOFF_${x}`));
    else {estimatedNetPnl=net.estimatedNetPnl;estimatedNetReturnPctOnPremium=net.estimatedNetReturnPctOnPremium;estimatedTotalCharges=net.estimatedTotalCharges;}
  }

  return {state:blockers.length?"UNAVAILABLE":"USABLE",targetTs,observedTs:exit?.ts??null,candidateKey:selection.decision==="SELECT"?selection.candidateKey:null,estimatedNetPnl,estimatedNetReturnPctOnPremium,estimatedTotalCharges,blockers:[...new Set(blockers)],ruleVersion:"OPTION_BUYER_FIXED_30M_PAYOFF_V1",horizonPolicy:"EXACT_PLUS_30_MINUTES_NO_NEAREST_SUBSTITUTION",contractPolicy:"SELECTOR_QUALIFIED_SAME_CONTRACT_ENTRY_AND_EXIT_ONLY",executionPricePolicy:"BUY_AT_VERIFIED_ASK_SELL_AT_VERIFIED_BID",semantics:"RESEARCH_ONLY_COMPARABLE_30M_NET_PAYOFF_ESTIMATE",affectsVerdict:false,affectsTelegram:false,affectsExecution:false,createsOrders:false,aiMayOverride:false};
}

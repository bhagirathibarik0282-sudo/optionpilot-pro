/** Strict read-only evidence envelope passed to RAG explanation/retrieval.
 * Model text never becomes evidence, a market number, or a trading decision.
 */
export type RagEvidenceReference={source:'POSTGRES_REPLAY';symbol:string;date:string;timeIst:string;strike:number;side:'CE'|'PE';expiry:string;snapshotId:string;price:number;previousPrice:number;changePercent:number};
export type RagEvidenceEnvelope={mode:'RAG_EVIDENCE_BOUNDARY_V1';status:'VERIFIED'|'NO_VERIFIED_EVIDENCE';readOnly:true;authority:'EXPLANATION_ONLY';references:RagEvidenceReference[];limits:string[]};
export function buildRagEvidenceEnvelope(scan:{events?:Array<{timeIst:string;strike:number;side:'CE'|'PE';comparison:{accepted?:Array<{expiry:string;price:number;previousPrice:number;changePercent:number;snapshotId:string}>}}>},symbol:string,date:string):RagEvidenceEnvelope{
 const references:RagEvidenceReference[]=[];
 for(const event of scan.events??[])for(const a of event.comparison.accepted??[]){
  if(!a.snapshotId||!Number.isFinite(a.price)||!Number.isFinite(a.previousPrice)||a.price<=0||a.previousPrice<=0||!Number.isFinite(a.changePercent))continue;
  references.push({source:'POSTGRES_REPLAY',symbol,date,timeIst:event.timeIst,strike:event.strike,side:event.side,expiry:a.expiry,snapshotId:a.snapshotId,price:a.price,previousPrice:a.previousPrice,changePercent:a.changePercent});
 }
 return {mode:'RAG_EVIDENCE_BOUNDARY_V1',status:references.length?'VERIFIED':'NO_VERIFIED_EVIDENCE',readOnly:true,authority:'EXPLANATION_ONLY',references,limits:['No synthetic or inferred prices.','No missing timestamps or causality claims.','No BUY/SELL authority.']};
}

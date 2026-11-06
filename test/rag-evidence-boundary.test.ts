import test from 'node:test';
import assert from 'node:assert/strict';
import {buildRagEvidenceEnvelope} from '../rag-evidence-boundary.js';
test('RAG does not manufacture evidence for missing events',()=>{
 const r=buildRagEvidenceEnvelope({events:[]},'NIFTY','2026-10-16');
 assert.equal(r.status,'NO_VERIFIED_EVIDENCE');assert.equal(r.references.length,0);assert.equal(r.authority,'EXPLANATION_ONLY');
});
test('RAG accepts only validated positive exact prices with source identity',()=>{
 const scan:any={events:[{timeIst:'09:24',strike:22650,side:'PE',comparison:{accepted:[{expiry:'2026-10-19',price:12,previousPrice:10,changePercent:20,snapshotId:'snap-1'},{expiry:'2026-10-27',price:0,previousPrice:10,changePercent:-100,snapshotId:'snap-2'}]}}]};
 const r=buildRagEvidenceEnvelope(scan,'NIFTY','2026-10-16');
 assert.equal(r.references.length,1);assert.equal(r.references[0].source,'POSTGRES_REPLAY');assert.equal(r.references[0].snapshotId,'snap-1');
});

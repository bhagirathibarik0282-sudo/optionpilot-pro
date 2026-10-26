import {randomBytes} from 'node:crypto';
import {Hono} from 'hono';
import {basicAuth} from 'hono/basic-auth';
import {RECORDED_REPLAY_HTML,installRecordedReplay,scopeRecordedReplay} from './recorded-replay-view.js';
import {deriveMarketBook} from './market-book-model.js';
import {mountRecorderEventContextLadderRoute} from './rag-recorder-event-ladder-bridge.js';

/** Fixed archived sample only. No database, application startup or live source here. */
export const PR799_PREVIEW_SELECTION={symbol:'NIFTY',date:'2026-10-19',expiry:'2026-10-19',strike:'23150',side:'PE',time:'10:45'} as const;
export function createPr799RecorderPreview(input:{password:string;state:any;evidence:any;now?:()=>number;ttlMs?:number}){
 if(input.password.length<32)throw new Error('PREVIEW_PASSWORD_TOO_SHORT');
 const ttl=input.ttlMs??600000;
 if(!Number.isInteger(ttl)||ttl<1||ttl>600000)throw new Error('PREVIEW_TTL_INVALID');
 const now=input.now??Date.now,expires=now()+ttl;
 // Snapshot ownership: subsequent mutation by the caller cannot alter a preview.
 const state=JSON.parse(JSON.stringify(input.state)),evidence=JSON.parse(JSON.stringify(input.evidence));
 const selected=PR799_PREVIEW_SELECTION;
 if(state.date!==selected.date||evidence.identity?.symbol!==selected.symbol||
    evidence.identity?.date!==selected.date||evidence.identity?.expiry!==selected.expiry||
    String(evidence.identity?.strike)!==selected.strike||evidence.identity?.side!==selected.side||
    evidence.event?.timeIst!==selected.time)throw new Error('PREVIEW_SAMPLE_IDENTITY_MISMATCH');
 const app=new Hono();
 app.use('*',async(c,next)=>{
   c.header('Cache-Control','no-store');c.header('Referrer-Policy','no-referrer');
   c.header('X-Content-Type-Options','nosniff');
   await next();
 });
 app.use('*',basicAuth({username:'preview',password:input.password,realm:'PR799 archived acceptance'}));
 app.use('*',async(c,next)=>{
   if(now()>=expires)return c.text('Archived preview expired',410);
   if(c.req.method!=='GET')return c.text('Read-only preview',405,{'Allow':'GET'});
   await next();
 });
 const recorder=(c:any)=>{
   const nonce=randomBytes(18).toString('base64');
   c.header('Content-Security-Policy',"default-src 'none'; script-src 'nonce-"+nonce+"'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
   const json=JSON.stringify(state).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
   const script='const __name=(f)=>f;const scopeRecordedReplay='+scopeRecordedReplay.toString()+
     ';const deriveMarketBook='+deriveMarketBook.toString()+';const installRecordedReplay='+installRecordedReplay.toString()+
     ';const state='+json+';const replay=installRecordedReplay({getState:()=>state,derive:deriveMarketBook});'+
     'document.getElementById("recorded-replay").open=true;document.getElementById("rr-rag-side").value="PE";'+
     'replay.seek(replayIndex());function replayIndex(){return scopeRecordedReplay(state,null).timeline.indexOf("2026-10-19T05:15:00.000Z");}';
   return c.html('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>PR799 archived Recorder preview</title>'+
     '<style>body{margin:0;font:16px/1.5 system-ui;background:#071225;color:#ecf6ff}main{max-width:1100px;margin:auto;padding:12px}.mb-controls{display:flex;flex-wrap:wrap;gap:8px}label{display:grid}button,select{min-height:44px;font:inherit;max-width:100%}.mb-chart{width:100%;max-width:650px}.mb-box{min-width:0;border-top:1px solid #33546b}.mb-note{overflow-wrap:anywhere}</style></head><body><main>'+
     '<h1>Archived Recorder acceptance</h1><p>Fixed NIFTY 19 Oct 2026 sample · bounded saved window, not live data or a complete session. Only 23150 PE at 10:45 can open the evidence page. Other selections stay unavailable in this preview.</p>'+
     RECORDED_REPLAY_HTML+'</main><script nonce="'+nonce+'">'+script+'</script></body></html>');
 };
 app.get('/',recorder);
 app.get('/api/research/business-dashboard/view',recorder);
 app.use('/api/research/rag-event-context-ladder/view',async(c,next)=>{
   const q=c.req.query();
   if(Object.keys(q).length!==Object.keys(selected).length||Object.entries(selected).some(([k,v])=>q[k]!==v)||
      [...new URL(c.req.url).searchParams.keys()].length!==Object.keys(selected).length)
     return c.text('Outside fixed archived preview selection',422);
   c.header('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'");
   await next();
 });
 const ladder=new Hono();
 mountRecorderEventContextLadderRoute(ladder,async()=>evidence);
 app.route('/api/research',ladder);
 return app;
}

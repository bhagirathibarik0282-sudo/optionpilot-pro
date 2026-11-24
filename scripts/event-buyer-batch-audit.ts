import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {auditEventBuyerSession} from '../event-buyer-batch-audit.js';
const [manifestPath,outputPath]=process.argv.slice(2);
if(!manifestPath||!outputPath)throw Error('Usage: node --import tsx scripts/event-buyer-batch-audit.ts manifest.json new-report.json');
if(existsSync(outputPath))throw Error('Output exists; choose a new name.');
const manifest=JSON.parse(readFileSync(manifestPath,'utf8'));
if(!Array.isArray(manifest.sessions)||!manifest.sessions.length)throw Error('Explicit sessions required.');
const root=dirname(resolve(manifestPath)),read=(name:string)=>JSON.parse(readFileSync(resolve(root,name),'utf8'));
const seen=new Set<string>(),sessions=[];
for(const item of manifest.sessions){
 const k=item.date+'|'+item.symbol;if(seen.has(k))throw Error('Duplicate session '+k);seen.add(k);
 const optional=(p:any)=>{try{return typeof p==='string'?read(p):undefined;}catch{return undefined;}};
 try{sessions.push(auditEventBuyerSession({...item,recorded:read(item.recordedFile),memory:read(item.memoryFile),participation:optional(item.participationFile),cash:optional(item.cashFile)}));}
 catch{sessions.push({date:item.date,symbol:item.symbol,status:'UNAVAILABLE',reason:'INPUT_READ_OR_PARSE_FAILED',results:[]});}
}
const report={mode:'OFFLINE_SAMPLED_RESEARCH_ONLY',requestedSessions:sessions.length,loadedSessions:sessions.filter(s=>s.status!=='UNAVAILABLE').length,unavailableSessions:sessions.filter(s=>s.status==='UNAVAILABLE').length,completeMarketGridSessions:sessions.filter(s=>s.status==='COMPLETE_MARKET_GRID_ONLY').length,netPnl:null,profitFactor:null,portfolioDrawdown:null,sessions};
writeFileSync(outputPath,JSON.stringify(report,null,2),{flag:'wx'});console.log(JSON.stringify({...report,sessions:undefined},null,2));

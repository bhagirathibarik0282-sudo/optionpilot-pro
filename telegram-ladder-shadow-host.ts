import {createLadderRuntime} from './telegram-ladder-runtime.js';
import {readExistingLadderFrames} from './telegram-ladder-existing-source.js';
import {indianTradingDateAt} from './market-session-calendar.js';

/** Existing timer binding, intentionally SHADOW-only. No outbox, credentials,
 * destination routing, new timer, network transport, or legacy cutover here.
 */
export function createLadderShadowHost(deps:{
  enabled:()=>boolean;
  read:Parameters<typeof createLadderRuntime>[0]['read'];
  log:(record:Record<string,unknown>)=>void;
}) {
  let runtime:ReturnType<typeof createLadderRuntime>|null=null;
  let busy=false,lastMinute=-1;
  return {async tick(now:number) {
    if(!deps.enabled()) {runtime=null;lastMinute=-1;return 'DISABLED';}
    if(!Number.isFinite(now))return 'INVALID_CLOCK';
    const minute=Math.floor(now/60_000);
    if(busy||minute===lastMinute)return 'SKIPPED';
    busy=true;
    try {
      if(!runtime) {
        const date=indianTradingDateAt(new Date(now));
        runtime=createLadderRuntime({mode:'SHADOW',
          // Internal namespace only; no sender or destination is constructed.
          destinationKey:'-1',activateAt:Date.parse(date+'T09:15:00+05:30'),read:deps.read,
          preview:async job=>{deps.log({state:'PLANNED',jobId:job.id,parts:job.parts.length,
            textParts:job.parts.filter(p=>typeof p==='string').length,
            documentBytes:job.parts.reduce((sum,p)=>sum+(typeof p==='string'?0:Buffer.byteLength(p.content,'utf8')),0),
            sendsPerformed:false,writesPerformed:false});},
        });
      }
      const result=await runtime.tick(now);
      if(result.state==='SHADOW_TICK')deps.log({...result,sendsPerformed:false,writesPerformed:false});
      lastMinute=minute;return result.state;
    }catch{
      // Contain source failures so dashboard recording and serving continue.
      deps.log({state:'SOURCE_READ_FAILED',sendsPerformed:false,writesPerformed:false});return 'FAILED';
    }finally{busy=false;}
  }};
}

const host=createLadderShadowHost({
  enabled:()=>process.env.TELEGRAM_LADDER_SHADOW_ENABLED?.trim().toLowerCase()==='true',
  read:readExistingLadderFrames,
  log:record=>console.info('[TELEGRAM_LADDER_SHADOW] '+JSON.stringify(record)),
});
export async function tickTelegramLadderShadow(now=Date.now()) {return host.tick(now);}

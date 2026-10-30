/** Reuses the application's existing PostgreSQL pool and app_state_log table.
 * Only explicit caller operations write; importing the module has no effects.
 */
import type {Job,LadderOutbox} from './telegram-ladder-outbox.js';
export const OUTBOX_KIND='TELEGRAM_LADDER_V4_OUTBOX';
type Client={query:(sql:string,args?:any[])=>Promise<{rows:any[]}>;release:()=>void};
type Pool={connect:()=>Promise<Client>};
type Stored=Job&{states:{status:'PENDING'|'SENDING'|'ACKED'|'RETRYABLE'|'UNKNOWN';receipt?:string;claimedAt?:number}[]};
export function createPostgresLadderOutbox(pool:Pool,now=Date.now):LadderOutbox&{pending:(prefix?:string)=>Promise<{job:Job;nextPart:number}[]>} {
  async function mutate<T>(id:string,fn:(p:Stored|null)=>{payload?:Stored;result:T}):Promise<T> {
    const c=await pool.connect();
    try {
      await c.query('BEGIN');await c.query("SET LOCAL statement_timeout='5s'");
      await c.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))',[OUTBOX_KIND,id]);
      const rows=(await c.query("SELECT id,payload FROM app_state_log WHERE kind=$1 AND payload->>'id'=$2 ORDER BY id",[OUTBOX_KIND,id])).rows;
      if(rows.length>1)throw Error('DUPLICATE_OUTBOX_JOB');
      const result=fn(rows[0]?.payload??null);
      if(result.payload) {
        if(rows.length)await c.query('UPDATE app_state_log SET payload=$1::jsonb WHERE id=$2',[JSON.stringify(result.payload),rows[0].id]);
        else await c.query('INSERT INTO app_state_log(kind,payload) VALUES($1,$2::jsonb)',[OUTBOX_KIND,JSON.stringify(result.payload)]);
      }
      await c.query('COMMIT');return result.result;
    }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}
  }
  return {
    async putIfAbsent(job) {
      if(!job.id.startsWith('LADDER_V4|')||!job.parts.length||job.parts.some(p=>typeof p==='string'?(!p.startsWith('📊 OPTIONPILOT LADDER V4 | ')||p.length>4096):p.kind!=='DOCUMENT'||!p.content||Buffer.byteLength(p.content,'utf8')>45*1024*1024))throw Error('INVALID_OUTBOX_JOB');
      return mutate(job.id,p=>p?{result:false}:{payload:{...job,states:job.parts.map(()=>({status:'PENDING'}))},result:true});
    },
    async claim(id,part) {return mutate(id,p=>{
      if(!p||!Number.isInteger(part)||part<0||part>=p.parts.length)throw Error('OUTBOX_PART_NOT_FOUND');
      if(p.states.slice(0,part).some(s=>s.status!=='ACKED')||!['PENDING','RETRYABLE'].includes(p.states[part].status))return {result:false};
      p.states[part]={status:'SENDING',claimedAt:now()};return {payload:p,result:true};
    });},
    async settle(id,part,result,receipt) {await mutate(id,p=>{
      if(!p||p.states[part]?.status!=='SENDING')throw Error('OUTBOX_NOT_CLAIMED');
      if(result==='ACKED'&&!receipt)throw Error('ACK_RECEIPT_REQUIRED');
      p.states[part]={status:result,...(receipt?{receipt}:{} )};return {payload:p,result:undefined};
    });},
    async pending(prefix='') {
      const c=await pool.connect();let ids:string[];
      try {ids=(await c.query(`SELECT payload->>'id' AS job_id FROM app_state_log WHERE kind=$1
        AND left(payload->>'id',length($2))=$2
        AND EXISTS (SELECT 1 FROM jsonb_array_elements(payload->'states') s WHERE s->>'status' IN ('PENDING','RETRYABLE','SENDING'))
        AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(payload->'states') s WHERE s->>'status'='UNKNOWN')
        ORDER BY id LIMIT 25`,[OUTBOX_KIND,prefix])).rows.map(r=>r.job_id);}finally{c.release();}
      const out:{job:Job;nextPart:number}[]=[];
      for(const id of ids)await mutate(id,p=>{
        if(!p)return {result:undefined};let dirty=false;
        for(const s of p.states)if(s.status==='SENDING'&&now()-(s.claimedAt??0)>120_000){s.status='UNKNOWN';dirty=true;}
        const next=p.states.findIndex(s=>s.status!=='ACKED');
        if(next>=0&&['PENDING','RETRYABLE'].includes(p.states[next].status))out.push({job:{id:p.id,parts:p.parts},nextPart:next});
        return {payload:dirty?p:undefined,result:undefined};
      });
      return out;
    },
  };
}

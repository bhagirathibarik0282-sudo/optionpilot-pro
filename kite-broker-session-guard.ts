import { createHash } from 'node:crypto';
import { resolveKiteAuthoritySession, subscribeKiteAuthoritySessionPersisted, type KiteAuthorityResolvedSession } from './kite-session-authority.js';

type CheckCode = 'NOT_CHECKED'|'VERIFIED'|'RECONNECT_REQUIRED'|'BROKER_UNAVAILABLE'|'ACCOUNT_MISMATCH';
type Check = { code:CheckCode; verified:boolean; checkedAt:string|null };
/** Broker acceptance is separate from local expiry. One bounded, single-flight profile check. */
export class KiteBrokerSessionGuard {
 private rejected=new Map<string,Check>();
 private current:{key:string;check:Check;due:number;pending?:Promise<Check>}|null=null;
 constructor(private deps:{now():number;fetch:typeof fetch}={now:Date.now,fetch:(...args)=>fetch(...args)}){}
 private key(apiKey:string,token:string){return createHash('sha256').update(apiKey+'\0'+token).digest('hex');}
 read():Check{return {...(this.current?.check||{code:'NOT_CHECKED',verified:false,checkedAt:null})};}
 reset(){this.current=null;this.rejected.clear();}
 isRejected(apiKey:string,token:string){return this.rejected.has(this.key(apiKey,token));}
 reject(apiKey:string,token:string){
  const key=this.key(apiKey,token),check:Check={code:'RECONNECT_REQUIRED',verified:false,checkedAt:new Date(this.deps.now()).toISOString()};
  this.rejected.set(key,check);while(this.rejected.size>16)this.rejected.delete(this.rejected.keys().next().value!);
  if(!this.current||this.current.key===key||this.current.key.startsWith(key+'|'))this.current={key,due:Infinity,check};
 }
 async verify(apiKey:string,session:Pick<KiteAuthorityResolvedSession,'accessToken'|'userId'>):Promise<Check>{
  const key=this.key(apiKey,session.accessToken)+'|'+session.userId,now=this.deps.now();
  // A broker rejection is sticky for that exact API key/token until explicit login rotation.
  const rejected=this.rejected.get(this.key(apiKey,session.accessToken));if(rejected)return {...rejected};
  if(this.current?.key===key){if(this.current.pending)return this.current.pending;if(now<this.current.due)return this.read();}
  const entry={key,check:{code:'NOT_CHECKED',verified:false,checkedAt:null} as Check,due:0,pending:undefined as Promise<Check>|undefined};this.current=entry;
  entry.pending=(async()=>{
   let code:CheckCode='BROKER_UNAVAILABLE';
   try{
    const response=await this.deps.fetch('https://api.kite.trade/user/profile',{headers:{'X-Kite-Version':'3',Authorization:'token '+apiKey+':'+session.accessToken},signal:AbortSignal.timeout(8000)});
    if(response.status===401||response.status===403)code='RECONNECT_REQUIRED';
    else if(response.ok){const body=await response.json() as any;if(body?.status==='success'&&typeof body.data?.user_id==='string')code=body.data.user_id===session.userId?'VERIFIED':'ACCOUNT_MISMATCH';}
   }catch{/* No URLs, response bodies or credentials escape the guard. */}
   if(this.current!==entry)return {code:'RECONNECT_REQUIRED',verified:false,checkedAt:new Date(this.deps.now()).toISOString()} as Check;
   entry.check={code,verified:code==='VERIFIED',checkedAt:new Date(this.deps.now()).toISOString()};
   if(code==='RECONNECT_REQUIRED'){this.rejected.set(this.key(apiKey,session.accessToken),entry.check);while(this.rejected.size>16)this.rejected.delete(this.rejected.keys().next().value!);}
   entry.due=code==='RECONNECT_REQUIRED'||code==='ACCOUNT_MISMATCH'?Infinity:this.deps.now()+(code==='VERIFIED'?60000:15000);
   entry.pending=undefined;return this.read();
  })();
  return entry.pending;
 }
}
const guard=new KiteBrokerSessionGuard();
subscribeKiteAuthoritySessionPersisted(()=>guard.reset());
export const readKiteBrokerSessionCheck=()=>guard.read();
export const isKiteBrokerSessionRejected=(apiKey:string,token:string)=>guard.isRejected(apiKey,token);
export function markKiteBrokerSessionRejected(apiKey:string,token:string){guard.reject(apiKey,token);}
export async function resolveVerifiedKiteAuthoritySession(){
 const resolved=await resolveKiteAuthoritySession(),apiKey=process.env.KITE_API_KEY?.trim();
 if(!apiKey)return {session:null,status:{...resolved.status,active:false,code:'NOT_CONFIGURED'}};
 if(!resolved.session||!resolved.status.active)return {...resolved,session:null};
 const check=await guard.verify(apiKey,resolved.session);
 return check.verified&&resolved.session.expiresAt>Date.now()?resolved:{session:null,status:{...resolved.status,active:false,reconnectRequired:check.code==='RECONNECT_REQUIRED'||check.code==='ACCOUNT_MISMATCH'||check.verified,code:check.verified?'RECONNECT_REQUIRED':check.code}};
}

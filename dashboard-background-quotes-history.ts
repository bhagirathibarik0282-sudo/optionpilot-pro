import { KEY_STOCKS, SECTORS } from './dashboard-background-quotes.js';
/** A bounded SELECT over existing collection rows; no broker calls or writes. */
export async function readBackgroundQuoteHistory(date:string,query:(sql:string,params:any[])=>Promise<any>,now=new Date()) {
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date+'T00:00:00Z'))||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date||date>new Date(now.getTime()+19800000).toISOString().slice(0,10))throw new Error('INVALID_DATE');
 const start=new Date(date+'T00:00:00+05:30'),end=new Date(start.getTime()+86400000);
 const result=await query('SELECT payload FROM app_state_log WHERE kind=$1 AND created_at >= $2 AND created_at < $3 ORDER BY created_at DESC,id DESC LIMIT 257',['DASHBOARD_BACKGROUND_QUOTES_V1',start.toISOString(),end.toISOString()]);
 if(!result)throw new Error('STORAGE_UNAVAILABLE');
 const finite=(v:any)=>typeof v==='number'&&Number.isFinite(v)?v:null;
 const clean=(r:any,symbol:string)=>({name:r.name,symbol,price:finite(r.price),previousClose:finite(r.previousClose),change:finite(r.change),pct:finite(r.pct),exchangeTimestamp:typeof r.exchangeTimestamp==='string'&&r.exchangeTimestamp.length<=40?r.exchangeTimestamp:null});
 const snapshots=result.rows.slice(0,256).map((row:any)=>row.payload).filter((s:any)=>s?.source==='SERVER_BACKGROUND_KITE_QUOTES'&&s.tradingDate===date&&typeof s.timestamp==='string'&&Number.isFinite(Date.parse(s.timestamp))&&Date.parse(s.timestamp)>=start.getTime()&&Date.parse(s.timestamp)<end.getTime()&&Date.parse(s.timestamp)<=now.getTime()).map((s:any)=>({source:s.source,tradingDate:date,timestamp:s.timestamp,
 stocks:Object.fromEntries(Object.entries(KEY_STOCKS).map(([index,names])=>[index,(Array.isArray(s.stocks?.[index])?s.stocks[index]:[]).filter((r:any)=>r&&Object.hasOwn(names,r.name)).slice(0,16).map((r:any)=>clean(r,(names as any)[r.name]))])),
 sectors:(Array.isArray(s.sectors)?s.sectors:[]).filter((r:any)=>r&&Object.hasOwn(SECTORS,r.name)).slice(0,24).map((r:any)=>clean(r,(SECTORS as any)[r.name]))})).reverse();
 return {date,snapshots,truncated:result.rows.length>256,source:'STORED_BACKGROUND_QUOTES',maxRows:256,readOnly:true};
}

/** Bounded field extraction, not semantic similarity or an LLM interpreter. */
export function parseRagQuestion(input:string) {
  const text=String(input??'').replace(/[୦-୯]/g,c=>String(c.charCodeAt(0)-'୦'.charCodeAt(0)))
    .replace(/\b\d{1,3}(?:,\d{3})+(?!\d)/g,value=>value.replace(/,/g,''));
  const fields:Record<string,string>={},issues:string[]=[];
  const select=(key:string,values:string[])=>{const unique=[...new Set(values)];if(unique.length===1)fields[key]=unique[0];else if(unique.length>1)issues.push(key+' ପାଇଁ ଏକାଧିକ value ଅଛି।');};
  const date=(v:string)=>{if(/^\d{4}-\d{2}-\d{2}$/.test(v))return v;const [d,m,y]=v.split('/');return `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;};
  select('symbol',Array.from(text.matchAll(/\b(BANK\s*NIFTY|NIFTY|SENSEX)\b/gi),m=>m[1].toUpperCase().replace(/\s/g,'')));
  select('side',Array.from(text.matchAll(/\b(CE|PE|CALL|PUT)\b/gi),m=>/^(CE|CALL)$/i.test(m[1])?'CE':'PE'));
  const pattern='(\\d{4}-\\d{2}-\\d{2}|\\d{1,2}/\\d{1,2}/\\d{4})';
  const expiryRe=new RegExp('(?:^|[\\s,;])(?:expiry|ମିଆଦ)\\s*[:=]?\\s*'+pattern,'gi');
  const dateRe=new RegExp('(?:^|[\\s,;])(?:date|ତାରିଖ)\\s*[:=]?\\s*'+pattern,'gi');
  select('expiry',Array.from(text.matchAll(expiryRe),m=>date(m[1])));
  const labelled=Array.from(text.matchAll(dateRe),m=>date(m[1]));
  const withoutExpiry=text.replace(expiryRe,' ');
  select('date',labelled.length?labelled:Array.from(withoutExpiry.matchAll(new RegExp(pattern,'g')),m=>date(m[1])));
  select('strike',[...Array.from(text.matchAll(/(?:^|[\s,;])(?:strike|ଷ୍ଟ୍ରାଇକ୍)\s*[:=]?\s*(\d{3,6})\b/gi),m=>m[1]),
    ...Array.from(text.matchAll(/(?:^|[\s;])(\d{3,6})\s*(?:CE|PE|CALL|PUT)\b/gi),m=>m[1])]);
  const labelledTimes=Array.from(text.matchAll(/(?:^|[\s,;])(?:time|at|ସମୟ)\s*[:=]?\s*(\d{1,2}:[0-5]\d)\s*(AM|PM)?\b/gi));
  const times=labelledTimes.length?labelledTimes:Array.from(text.matchAll(/\b(\d{1,2}:[0-5]\d)\s*(AM|PM)?\b/gi));
  select('time',times.map(m=>{let [h,min]=m[1].split(':').map(Number);if(m[2]){if(h<1||h>12)return 'INVALID';h=h%12+(/pm/i.test(m[2])?12:0);}return `${String(h).padStart(2,'0')}:${String(min).padStart(2,'0')}`;}));
  const missing=['symbol','date','expiry','strike','side','time'].filter(k=>!fields[k]);
  return {fields,missing,issues,complete:missing.length===0&&issues.length===0};
}

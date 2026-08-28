import fs from 'node:fs';

const src = fs.readFileSync('server.ts','utf8');
const needle = /add\(['"]max_pain['"]\s*,\s*m\.current\s*<\s*m\.maxPain\s*\?\s*0\.5\s*:\s*m\.current\s*>\s*m\.maxPain\s*\?\s*-0\.5\s*:\s*0\s*,\s*0\.5\s*\)/g;
const hits = [...src.matchAll(needle)].map(m => m.index ?? -1);

function matchingBrace(open){
  let depth=0, quote=null, esc=false, line=false, block=false;
  for(let i=open;i<src.length;i++){
    const c=src[i], n=src[i+1];
    if(line){ if(c==='\n') line=false; continue; }
    if(block){ if(c==='*'&&n==='/'){block=false;i++;} continue; }
    if(quote){ if(esc){esc=false;continue;} if(c==='\\'){esc=true;continue;} if(c===quote) quote=null; continue; }
    if(c==='"'||c==="'"||c==='`'){quote=c;continue;}
    if(c==='/'&&n==='/'){line=true;i++;continue;}
    if(c==='/'&&n==='*'){block=true;i++;continue;}
    if(c==='{') depth++;
    else if(c==='}'){ depth--; if(depth===0) return i; }
  }
  return -1;
}

const fnRe = /(async\s+)?function\s+([A-Za-z0-9_$]+)\s*\([^)]*\)\s*\{|const\s+([A-Za-z0-9_$]+)\s*=\s*(async\s*)?\([^)]*\)\s*=>\s*\{/g;
const funcs=[];
for(const m of src.matchAll(fnRe)){
  const open = (m.index ?? 0) + m[0].lastIndexOf('{');
  const end = matchingBrace(open);
  if(end>open) funcs.push({name:m[2]||m[3]||'anonymous',start:m.index??0,open,end});
}

const report = hits.map((pos,i)=>{
  const containers = funcs.filter(f=>f.open<pos && pos<f.end).sort((a,b)=>(b.end-b.open)-(a.end-a.open));
  const outer = containers[0] ?? null;
  const inner = containers[containers.length-1] ?? null;
  const names = containers.map(f=>f.name);
  const outerRefs = outer ? [...src.matchAll(new RegExp('\\b'+outer.name.replace(/[$]/g,'\\$&')+'\\s*\\(','g'))].map(x=>x.index??-1).filter(x=>x!==outer.start) : [];
  return {
    ordinal:i+1,
    pos,
    containingFunctions:names,
    outerFunction:outer?.name??null,
    innerFunction:inner?.name??null,
    outerReferenceCount:outerRefs.length,
    outerReferencePositions:outerRefs.slice(0,20),
    context:src.slice(Math.max(0,pos-300),Math.min(src.length,pos+500)).replace(/\s+/g,' ')
  };
});
console.log(JSON.stringify({phase:'PHASE76_SECOND_MAX_PAIN_PATH_AUDIT_V2',hitCount:hits.length,report},null,2));
if(hits.length!==1) process.exit(2);

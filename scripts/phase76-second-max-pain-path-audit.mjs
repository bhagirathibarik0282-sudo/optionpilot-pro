import fs from 'node:fs';

const src = fs.readFileSync('server.ts','utf8');
const needle = /add\(['"]max_pain['"]\s*,\s*m\.current\s*<\s*m\.maxPain\s*\?\s*0\.5\s*:\s*m\.current\s*>\s*m\.maxPain\s*\?\s*-0\.5\s*:\s*0\s*,\s*0\.5\s*\)/g;
const hits = [...src.matchAll(needle)].map(m => m.index ?? -1);

function lexicalStateAt(pos){
  let state='code', esc=false;
  for(let i=0;i<pos;i++){
    const c=src[i], n=src[i+1];
    if(state==='line'){ if(c==='\n') state='code'; continue; }
    if(state==='block'){ if(c==='*'&&n==='/'){state='code';i++;} continue; }
    if(state==='single'){ if(esc){esc=false;continue;} if(c==='\\'){esc=true;continue;} if(c==="'") state='code'; continue; }
    if(state==='double'){ if(esc){esc=false;continue;} if(c==='\\'){esc=true;continue;} if(c==='"') state='code'; continue; }
    if(state==='template'){ if(esc){esc=false;continue;} if(c==='\\'){esc=true;continue;} if(c==='`') state='code'; continue; }
    if(c==='/'&&n==='/'){state='line';i++;continue;}
    if(c==='/'&&n==='*'){state='block';i++;continue;}
    if(c==="'"){state='single';continue;}
    if(c==='"'){state='double';continue;}
    if(c==='`'){state='template';continue;}
  }
  return state;
}

const report = hits.map((pos,i)=>({
  ordinal:i+1,
  pos,
  lexicalState:lexicalStateAt(pos),
  nearbyHasScriptTag:/<script[\s>]/i.test(src.slice(Math.max(0,pos-12000),pos)),
  nearestBefore:src.slice(Math.max(0,pos-1200),pos).replace(/\s+/g,' ').slice(-900),
  context:src.slice(Math.max(0,pos-280),Math.min(src.length,pos+480)).replace(/\s+/g,' ')
}));

console.log(JSON.stringify({phase:'PHASE76_SECOND_MAX_PAIN_PATH_AUDIT_V3',hitCount:hits.length,report},null,2));
if(hits.length!==1) process.exit(2);

import fs from 'node:fs';

const src = fs.readFileSync('server.ts','utf8');
const needle = /add\(['"]max_pain['"]\s*,\s*m\.current\s*<\s*m\.maxPain\s*\?\s*0\.5\s*:\s*m\.current\s*>\s*m\.maxPain\s*\?\s*-0\.5\s*:\s*0\s*,\s*0\.5\s*\)/g;
const hits = [...src.matchAll(needle)].map(m => m.index ?? -1);

function enclosingFunction(pos){
  const before = src.slice(0,pos);
  const fnRe = /(async\s+)?function\s+([A-Za-z0-9_$]+)\s*\([^)]*\)\s*\{|const\s+([A-Za-z0-9_$]+)\s*=\s*(async\s*)?\([^)]*\)\s*=>\s*\{/g;
  let match, last = null;
  while((match = fnRe.exec(before))) last = match;
  if(!last) return null;
  const name = last[2] || last[3] || 'anonymous';
  return {name,start:last.index};
}

const report = hits.map((pos,i)=>{
  const fn = enclosingFunction(pos);
  const context = src.slice(Math.max(0,pos-220), Math.min(src.length,pos+420)).replace(/\s+/g,' ');
  const fnName = fn?.name ?? null;
  let refs = [];
  if(fnName){
    const refRe = new RegExp('\\b'+fnName.replace(/[$]/g,'\\$&')+'\\s*\\(', 'g');
    refs = [...src.matchAll(refRe)].map(x=>x.index ?? -1).filter(x=>x!==fn.start).slice(0,20);
  }
  return {ordinal:i+1,pos,fnName,referenceCount:refs.length,referencePositions:refs,context};
});

console.log(JSON.stringify({phase:'PHASE76_SECOND_MAX_PAIN_PATH_AUDIT',hitCount:hits.length,report},null,2));
if(hits.length !== 1){
  console.error(`PHASE76_REVIEW_REQUIRED: expected exactly one remaining Max Pain directional block after Phase75, found ${hits.length}`);
  process.exit(2);
}

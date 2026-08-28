import fs from 'node:fs';

const path='server.ts';
let src=fs.readFileSync(path,'utf8');
const marker='function runRuleEngineServer';
const start=src.indexOf(marker);
if(start<0){ console.error('PHASE76_PATCH_FAIL: runRuleEngineServer not found'); process.exit(1); }
const nextFn=src.indexOf('\nfunction ', start+marker.length);
const end=nextFn>start?nextFn:src.length;
let body=src.slice(start,end);
const vote=/if\s*\(\s*availableSignals\.has\(["']max_pain["']\)\s*&&\s*m\.maxPain\s*>\s*0\s*\)\s*\{\s*add\(["']max_pain["']\s*,\s*m\.current\s*<\s*m\.maxPain\s*\?\s*0\.5\s*:\s*m\.current\s*>\s*m\.maxPain\s*\?\s*-0\.5\s*:\s*0\s*,\s*0\.5\s*\);\s*\}/g;
const matches=[...body.matchAll(vote)];
if(matches.length!==1){ console.error(`PHASE76_PATCH_FAIL: expected exactly one server Max Pain vote, found ${matches.length}`); process.exit(1); }
body=body.replace(vote,'');
src=src.slice(0,start)+body+src.slice(end);
fs.writeFileSync(path,src);
console.log('PHASE76_PATCH: removed Max Pain directional vote from runRuleEngineServer only');

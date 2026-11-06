import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {stripTypeScriptTypes} from 'node:module';
const script=fileURLToPath(new URL('../scripts/wire-market-session-calendar.mjs',import.meta.url));
const code=fs.readFileSync(script,'utf8');
const clock=code.match(/const oldClockBlock = `([\s\S]*?)`;/)[1];
const anchor=code.match(/const truthAnchor = `([\s\S]*?)`;/)[1];
const fixture=[
'import { shouldRefreshCandidateSnapshot } from "./candidate-snapshot-freshness.js";',
'function computeTruthReport(m: IndexMetrics | undefined): TruthReport {',anchor,'}',clock,
'app.get("/api/holidays", (c) => {\n  return c.json([]);\n});',
].join('\n');
function withSource(fn){const root=fs.mkdtempSync(path.join(os.tmpdir(),'calendar-wiring-audit-'));try{
 fs.writeFileSync(path.join(root,'server.ts'),fixture);fs.writeFileSync(path.join(root,'package.json'),'{"type":"module"}');fn(root,path.join(root,'server.ts'));
}finally{fs.rmSync(root,{recursive:true,force:true});}}
function wire(root,...args){return spawnSync(process.execPath,[script,...args],{cwd:root,encoding:'utf8'});}
function compile(file){const js=file+'.mjs';fs.writeFileSync(js,stripTypeScriptTypes(fs.readFileSync(file,'utf8')));return spawnSync(process.execPath,['--check',js],{encoding:'utf8'});}
test('calendar wiring remains byte-stable and syntactically valid after repeated prepare calls',()=>withSource((root,file)=>{
 let first;
 for(let i=0;i<5;i++){
  const r=wire(root);assert.equal(r.status,0,r.stderr);
  const source=fs.readFileSync(file,'utf8');if(i===0)first=source;else assert.equal(source,first);
  assert.equal(source.split('const calendarPhase = indianEquityMarketPhaseAt(now);').length-1,1);
  assert.equal(source.split('} from "./market-session-calendar.js";').length-1,1);
  const c=compile(file);assert.equal(c.status,0,c.stderr);
 }
}));
test('--check validates transformations without modifying source',()=>withSource((root,file)=>{
 const r=wire(root,'--check');assert.equal(r.status,0,r.stderr);assert.equal(fs.readFileSync(file,'utf8'),fixture);
}));
test('already corrupted runtime copy is rejected without rewriting it',()=>withSource((root,file)=>{
 assert.equal(wire(root).status,0);
 const marker='const calendarPhase = indianEquityMarketPhaseAt(now);';
 const corrupted=fs.readFileSync(file,'utf8').replace(marker,marker+'\n  '+marker);
 fs.writeFileSync(file,corrupted);
 const r=wire(root);assert.notEqual(r.status,0);assert.equal(fs.readFileSync(file,'utf8'),corrupted);
}));

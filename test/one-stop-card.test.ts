import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { WORKSPACE_NAV_HTML, WORKSPACE_CSS, installDashboardWorkspace } from '../dashboard-workspace-view.js';
import { renderBusinessDashboardV1Html } from '../business-dashboard-v1-view.js';

test('one-stop card is a single top-level workspace panel, not hidden inside feed/settings',()=>{
 const html=renderBusinessDashboardV1Html({} as any);
 assert.equal((html.match(/id="op-one-stop"/g)||[]).length,1);
 const head=html.indexOf('id="op-workspace-top"'),one=html.indexOf('id="op-one-stop"');
 const tools=html.indexOf('id="mb-tools"');
 assert(head>=0&&one>head&&tools>one);
 assert.match(WORKSPACE_NAV_HTML, /<\/div><\/div><section id="op-one-stop"/);
 assert.match(WORKSPACE_CSS, /\.op-one-scroll\{overflow-x:auto/);
});
test('one-stop exposes exactly four existing destinations and never requests or executes a trade',()=>{
 const buttons=[...WORKSPACE_NAV_HTML.matchAll(/data-op-one="([^"]+)"/g)].map(m=>m[1]);
 assert.deepEqual(buttons,['LIVE','LADDER','MULTIDAY','RAG']);
 const installer=installDashboardWorkspace.toString();
 assert.match(installer,/openLadder\(\{source:'LIVE'\}\)/);
 assert.match(installer,/openLadder\(\{source:'RECORDED'\}\)/);
 assert.match(installer,/rag-evidence-card/);
 assert.doesNotMatch(installer,/new EventSource|fetch\(|placeOrder|sendOrder|orderSubmit/);
});
test('one-stop withholds disconnected, stale and incomplete values',()=>{
 const installer=installDashboardWorkspace.toString();
 assert.match(installer,/d\?\.connected===true/);
 assert.match(installer,/q\?\.state==='LIVE'/);
 assert.match(installer,/p\.coverage\?\.complete===true/);
 assert.match(installer,/p\.expiry===a\.expiry/);
 assert.match(installer,/serverMs-at/);
 assert.match(installer,/No fresh Kite stream/);
});
test('one-stop serialized browser script parses without changing existing source ordering',()=>{
 const html=renderBusinessDashboardV1Html({} as any);
 const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
 assert(scripts.length>=4);
 for(const script of scripts)assert.doesNotThrow(()=>new vm.Script(script));
 assert.equal((html.match(/dashboard-live\/stream/g)||[]).length,1);
 assert.match(html,/One shared stream; exact expiry and source timestamps/);
});

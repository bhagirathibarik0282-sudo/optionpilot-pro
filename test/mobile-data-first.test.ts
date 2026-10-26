import test from 'node:test';
import assert from 'node:assert/strict';
import {renderOneShotCard,ONE_SHOT_CSS} from '../one-shot-live-card.js';
import {WORKSPACE_NAV_HTML,WORKSPACE_CSS} from '../dashboard-workspace-view.js';

test('three-index Kite/Recorder radar and complete-PCR status lead the mobile workspace',()=>{
 const html=renderOneShotCard('<details id="op-atm-weeklies"></details>');
 const sequence=['id="os-market-radar"','id="os-pcr-strip"','id="os-premium"','id="os-index"','id="os-source"','id="op-one-actions"','id="os-navigation"'];
 const positions=sequence.map(x=>html.indexOf(x));
 assert(positions.every(x=>x>=0),JSON.stringify(positions));
 assert(positions.every((v,i)=>!i||v>positions[i-1]),'source-driven radar first, four expiries before advanced controls');
 for(const id of ['os-market-radar','os-pcr-strip','os-index','os-source','op-one-actions','os-navigation'])assert.equal(html.split('id="'+id+'"').length-1,1,id+' must remain unique');
 assert(html.includes('href="#os-premium"')&&html.includes('href="#os-pulse"'));
 assert(html.includes('href="#op-research-controls"'));
 assert(WORKSPACE_NAV_HTML.includes('id="op-research-open-data"'));
 assert(WORKSPACE_NAV_HTML.includes('id="op-research-settings"'));
});
test('CSS offers dense one-column mobile radar without obscuring unknown/stale market values',()=>{
 assert.match(ONE_SHOT_CSS,/@media\(max-width:600px\)/);
 assert.match(ONE_SHOT_CSS,/#op-one-stop \.os-markets\{grid-template-columns:minmax\(0,1fr\)/);
 assert.match(ONE_SHOT_CSS,/#op-one-stop \.os-pcr-strip\{display:grid;grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
 assert.match(ONE_SHOT_CSS,/#op-one-stop \.os-fast-links a:focus-visible/);
 assert.match(WORKSPACE_CSS,/#op-research-controls strong\{font-size:13px\}/);
 assert(!ONE_SHOT_CSS.includes('display:none!important}#os-market-radar'));
});

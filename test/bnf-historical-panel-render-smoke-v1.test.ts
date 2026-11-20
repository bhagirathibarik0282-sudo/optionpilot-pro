import test from 'node:test';
import assert from 'node:assert/strict';
import {renderBusinessDashboardV1Html} from '../business-dashboard-v1-view.js';
import {renderRecordedDashboard} from '../recorded-dashboard-view.js';
import {renderBnfShadowPage} from '../bnf-shadow-page.js';

test('dedicated SHADOW page preserves one historical audit, day-wise journal and private timeline',()=>{
 const html=renderBnfShadowPage();
 for(const id of ['bnf-historical-evidence','bnf-shadow-timeline'])assert.equal((html.match(new RegExp('id="'+id+'"','g'))||[]).length,1);
 assert.equal((html.match(/class="op-bnf-daywise"/g)||[]).length,1);
 assert.match(html,/installBnfHistoricalPanel/);assert.match(html,/installBnfShadowDaywise/);
 assert.match(html,/not uploaded or stored/);assert.match(html,/est = estimated/);
 for(const [,script] of html.matchAll(/<script>([\s\S]*?)<\/script>/g))assert.doesNotThrow(()=>new Function(script));
});
test('live and off-hours market dashboards link to SHADOW without the large panels',()=>{
 for(const html of [renderBusinessDashboardV1Html({} as any),renderRecordedDashboard(true)]){
  assert.equal((html.match(/id="bnf-historical-evidence"/g)||[]).length,0);
  assert.equal((html.match(/id="bnf-shadow-timeline"/g)||[]).length,0);
  assert.equal((html.match(/class="op-bnf-daywise"/g)||[]).length,0);
  assert.match(html,/href="\/banknifty-shadow"/);
 }
 const html=renderRecordedDashboard(true);assert.match(html,/id="ar-play"/);assert.match(html,/id="ar-dates"/);
});

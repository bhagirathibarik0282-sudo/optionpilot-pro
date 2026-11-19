import test from 'node:test';
import assert from 'node:assert/strict';
import {renderBusinessDashboardV1Html} from '../business-dashboard-v1-view.js';
import {renderRecordedDashboard} from '../recorded-dashboard-view.js';

test('existing dashboard embeds exactly one local historical audit panel without replacing the shadow journal',()=>{
 const html=renderBusinessDashboardV1Html({} as any);
 assert.equal((html.match(/id="bnf-historical-evidence"/g)||[]).length,1);
 assert.match(html,/BANKNIFTY · Historical 35-day evidence audit/);
 assert.match(html,/const deriveBnfHistoricalReview=/);
 assert.match(html,/installBnfHistoricalPanel/);
 assert.match(html,/installBnfShadowDaywise/);
 assert.match(html,/INTRADAY/);
 assert.match(html,/MEMORY/);
 assert.match(html,/not uploaded or stored/);
});
test('off-hours replay embeds the audit beside existing read-only replay',()=>{
 const html=renderRecordedDashboard(true);
 assert.equal((html.match(/id="bnf-historical-evidence"/g)||[]).length,1);
 assert.match(html,/id="ar-play"/);
 assert.match(html,/id="ar-dates"/);
 assert.match(html,/BANKNIFTY · SHADOW PAPER/);
 assert.match(html,/const deriveBnfHistoricalReview=/);
 assert.match(html,/installBnfHistoricalPanel/);
 assert.match(html,/installBnfShadowDaywise/);
});

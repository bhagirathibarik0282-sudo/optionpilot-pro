import test from 'node:test';
import assert from 'node:assert/strict';
import {renderOneShotCard,ONE_SHOT_CSS,installOneShotLiveCard} from '../one-shot-live-card.js';
import {WORKSPACE_NAV_HTML} from '../dashboard-workspace-view.js';

test('reference terminal reuses real source-driven views in seven numbered sections',()=>{
 const html=renderOneShotCard('<details id="op-atm-weeklies"></details>');
 const ordered=['id="os-radar"','id="os-market-radar"','id="os-pcr-strip"','id="os-rag-context"','id="os-futures"','id="os-walls"','id="os-premium"','id="os-stocks"','id="os-sectors"','id="os-notables"','id="os-memory"','id="os-index"','id="op-one-actions"'];
 const indices=ordered.map(id=>html.indexOf(id));
 assert(indices.every(x=>x>=0),JSON.stringify(indices));
 assert(indices.every((x,i)=>i===0||x>indices[i-1]),'source-backed sections retain deliberate reading order');
 for(const id of ['os-market-radar','os-pcr-strip','os-events','os-stock-ranks','os-sector-ranks','os-rag-open','os-memory-open','op-one-actions'])assert.equal(html.split('id="'+id+'"').length-1,1,id+' uniqueness');
 assert.match(html,/No similarity percentage, market bias, sector bias or FII\/DII interpretation/);
 assert.doesNotMatch(html,/probability/i);
 assert(!html.includes('82%'),'historical probability may not be fabricated');
 assert(!html.includes('23,145.60'),'reference figures must not be hardcoded');
 assert(!html.includes('520M'),'mockup OI must not become live data');
 assert.match(installOneShotLiveCard.toString(),/data-op-one="RAG"/);
 assert.match(installOneShotLiveCard.toString(),/data-op-one="RECORDED"/);
 assert(WORKSPACE_NAV_HTML.includes('id="op-research-open-data"'));
});

test('reference layout prioritizes seven sections and functional three-index controls',()=>{
 const html=renderOneShotCard('<details id="op-atm-weeklies"></details>');
 assert(!html.includes('id="os-command-deck"'),'superseded four-hub cards must not displace the reference tables');
 for(const id of ['os-futures','os-walls','os-premium','os-stocks','os-sectors','os-notables','os-memory'])assert(html.includes('id="'+id+'"'));
 assert.equal((WORKSPACE_NAV_HTML.match(/data-os-select=/g)||[]).length,3);
 assert(html.includes('id="os-premium-table"'));
 assert(html.includes('id="os-detailed-views"'));
 const handler=installOneShotLiveCard.toString();
 assert(handler.includes('os-reference-indices'));
 assert(!handler.includes('fetch('),'navigation must not cause provider requests');
});

test('reference layout retains touch navigation, source labels and responsive containment',()=>{
 assert.match(ONE_SHOT_CSS,/#op-one-stop \.os-terminal-head\{display:grid/);
 assert.match(ONE_SHOT_CSS,/@media\(max-width:850px\)\{#op-one-stop \.os-terminal-head\{grid-template-columns:minmax\(0,1fr\)/);
 assert.match(ONE_SHOT_CSS,/#market-book #op-workspace-nav\{display:block;margin:0 0 5px\}/);
 assert.match(ONE_SHOT_CSS,/#market-book #op-chapter-links\{display:flex;gap:4px;overflow-x:auto/);
 assert.match(ONE_SHOT_CSS,/#op-one-stop \.os-evidence-shortcuts a:focus-visible/);
 assert.match(ONE_SHOT_CSS,/#market-book #op-one-stop \.os-table/);
 assert(ONE_SHOT_CSS.includes("#market-book[data-main-chapter='1'] #op-view-links{display:flex"),'mobile Research subviews remain reachable');
});

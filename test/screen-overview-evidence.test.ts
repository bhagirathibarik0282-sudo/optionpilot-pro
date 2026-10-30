import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { installScreenOverview, SCREEN_OVERVIEW_CSS, SCREEN_OVERVIEW_HTML } from '../screen-overview.js';

function harness(screenWidth = 1024) {
  let selected = 'NIFTY', price = '100', validation = 'TRUE', recordedAt = '2026-10-27T06:06:00Z';
  const nodes = new Map<string, any>();
  const node = (extra: any = {}) => ({ textContent: '', innerHTML: '', dataset: {}, style: {},
    querySelector: () => null, querySelectorAll: () => [], addEventListener() {},
    appendChild() {}, setAttribute() {}, ...extra });
  const tableSource = (heads: string[], rows: string[][], symbol = '') => node({ dataset: { recordedIndex: symbol },
    querySelector: (selector: string) => selector !== 'table' ? null : {
      querySelectorAll: (selector: string) => selector === 'thead th' ? heads.map(textContent => ({ textContent })) :
        rows.map(row => ({ querySelector: () => null, cells: row.map(textContent => ({ textContent })) })),
    } });
  const events = tableSource(['Time', 'Category', 'Observation', 'Exact response contract'],
    [['11:33 → 11:36', 'Premium', 'fixture event', 'NIFTY · 2026-10-27 · 22750 CE / PE']], 'NIFTY');
  const memory = tableSource(['Series / exact contract', 'Prior', 'Current'],
    [['Spot · NIFTY', '22000', '22757.8'], ['CE · NIFTY 2026-10-27 22750', '100', '61.9']], 'NIFTY');
  nodes.set('market-book', node({ dataset: { mainChapter: '1', chapter: '1' } }));
  nodes.set('op-one-stop', node({ dataset: { osSource: 'RECORDED' }, querySelector: () => node({ dataset: { recordedValidation: validation, recordedAt },
    querySelector: (selector: string) => selector === '.os-market-head' ? node({ textContent: selected }) :
      selector === '.os-price' ? node({ textContent: price }) : null,
  }) }));
  nodes.set('mb-page', node({ querySelector: (selector: string) => selector.includes('Recorded notable events') ? events :
    selector.includes('Recorder memory and replay') ? memory : null }));
  nodes.set('rd-page', node({ scrollHeight: 700 }));
  nodes.set('rd-viewport', node({ clientWidth: screenWidth, clientHeight: 800 }));
  for (const id of ['rd-market-head','rd-market-levels','rd-market-metrics','rd-levels-table','rd-pcr-table',
    'rd-premium-table','rd-stock-table','rd-sector-table','rd-event-table','rd-memory-table','rd-context-rows',
    'rd-source','rd-fit-tools','rd-source-tables','rd-return','rd-settings','os-screen-close','os-screen-detail','os-screen-detail-body']) {
    nodes.set(id, node());
  }
  const context: any = { document: { getElementById: (id: string) => nodes.get(id),
    body: { dataset: {} }, createElement: () => node(), querySelectorAll: () => [], addEventListener() {} },
    window: { innerWidth: screenWidth, addEventListener() {} }, MutationObserver: class { observe() {} },
    __name: (fn: any) => fn, requestAnimationFrame: () => 1 };
  const installer = vm.runInNewContext(`(${installScreenOverview.toString()})`, context);
  const view = installer();
  return {
    nodes, events, memory,
    fitMode(mode:string){const button=node({dataset:{rdFit:mode}});nodes.get('rd-fit-tools').onclick({target:{closest:()=>button}});},
    source(id:string,heads:string[],rows:string[][]){nodes.set(id,tableSource(heads,rows));view.refresh();},
    pcr(index:string,full:string,reportedValue:string|null){
      const simple=(value:string)=>node({textContent:value});
      const reported=reportedValue===null?null:node({
        querySelector:(selector:string)=>selector==='b'?simple(reportedValue):null,
        querySelectorAll:(selector:string)=>selector==='small'?[simple('288/288 contracts · 6 older than 30s')]:[],
      });
      const card=node({
        querySelector:(selector:string)=>selector===':scope>strong'?simple(index):selector===':scope>b'?simple(full):selector==='.os-pcr-reported'?reported:null,
        querySelectorAll:(selector:string)=>selector===':scope>small'?[simple('OI 282/288 fresh · stale 6')]:[],
      });
      nodes.set('os-pcr-strip',node({querySelectorAll:(selector:string)=>selector==='.os-pcr'?[card]:[]}));
      view.refresh();
    },
    futures(heads:string[],rows:string[][]){nodes.set('os-future-response',tableSource(heads,rows));view.refresh();},
    headline(value:string,status:string){price=value;validation=status;view.refresh();},
    premium(heads:string[],rows:string[][]){nodes.set('os-premium-table',tableSource(heads,rows));view.refresh();},
    select(symbol: string) { selected = symbol; view.refresh(); },
  };
}

test('changing selected index never exposes another index recorded events or memory', () => {
  const h = harness();
  assert.match(h.nodes.get('rd-event-table').innerHTML, /NIFTY · 2026-10-27/);
  assert.match(h.nodes.get('rd-memory-table').innerHTML, /CE · NIFTY/);
  for (const symbol of ['SENSEX', 'BANKNIFTY']) {
    h.select(symbol);
    for (const id of ['rd-event-table','rd-memory-table']) {
      assert.doesNotMatch(h.nodes.get(id).innerHTML, /NIFTY ·|Spot · NIFTY|CE · NIFTY/);
      assert.match(h.nodes.get(id).innerHTML, new RegExp('No verified recorded .* for '+symbol));
    }
  }
  h.select('NIFTY'); assert.match(h.nodes.get('rd-memory-table').innerHTML, /CE · NIFTY/);
});
test('source identity alone cannot admit a wrong exact-contract row', () => {
  const h = harness(); h.events.dataset.recordedIndex = 'BANKNIFTY'; h.memory.dataset.recordedIndex = 'BANKNIFTY';
  h.select('BANKNIFTY');
  assert.doesNotMatch(h.nodes.get('rd-event-table').innerHTML, /fixture event/);
  assert.doesNotMatch(h.nodes.get('rd-memory-table').innerHTML, /22757.8/);
});
test('missing source identity fails closed instead of borrowing the previous index', () => {
  const h = harness(); delete h.events.dataset.recordedIndex; delete h.memory.dataset.recordedIndex;
  h.select('NIFTY'); assert.match(h.nodes.get('rd-event-table').innerHTML, /No verified/);
  assert.match(h.nodes.get('rd-memory-table').innerHTML, /No verified/);
});


test('placeholder expiries do not claim price-pair coverage',()=>{
 const h=harness(),heads=['Type','Strike','Expiry','LTP ₹','Status'];
 h.premium(heads,['2026-10-29','2026-11-05','2026-11-12','2026-11-26'].flatMap(expiry=>['CE','PE'].map(side=>[side,'—',expiry,'—','UNAVAILABLE'])));
 const output=h.nodes.get('rd-context-rows').innerHTML;
 assert.match(output,/0\/4 displayed expiries/);assert.match(output,/0\/8 rows/);
 assert.doesNotMatch(output,/4\/4 visible/);
});
test('coverage requires unique same-strike CE and PE; side filters remain explicit',()=>{
 const h=harness(),heads=['Type','Strike','Expiry','LTP ₹','Status'];
 const ce=['CE','54,400','2026-11-23','100','RECORDED'],pe=['PE','54,400','2026-11-23','150','RECORDED'];
 h.premium(heads,[ce,pe]);assert.match(h.nodes.get('rd-context-rows').innerHTML,/1\/1 displayed expiries/);
 h.premium(heads,[ce,[...pe.slice(0,1),'54,500',...pe.slice(2)]]);assert.match(h.nodes.get('rd-context-rows').innerHTML,/0\/1 displayed expiries/);
 h.premium(heads,[ce,ce,pe]);assert.match(h.nodes.get('rd-context-rows').innerHTML,/0\/1 displayed expiries/);
 h.premium(heads,[ce]);assert.match(h.nodes.get('rd-context-rows').innerHTML,/Hidden by CE-only view/);
});


test('withheld headline explains validation instead of promoting another recorded price',()=>{
 const h=harness();h.select('SENSEX');h.headline('—','PARTIAL');
 const output=h.nodes.get('rd-market-head').innerHTML;
 assert.match(output,/SENSEX/);assert.match(output,/Headline withheld/);assert.match(output,/PARTIAL/);
 assert.match(output,/27 Oct/);assert.match(output,/11:36:00/);
 assert.doesNotMatch(output,/22757.8/);
 h.headline('73547.87','TRUE');assert.doesNotMatch(h.nodes.get('rd-market-head').innerHTML,/Headline withheld/);
});
test('nonfinite displayed price never counts as usable coverage',()=>{
 const h=harness();h.premium(['Type','Strike','Expiry','LTP ₹','Status'],[['CE','100','2026-11-23','9'.repeat(400),'RECORDED'],['PE','100','2026-11-23','150','RECORDED']]);
 assert.match(h.nodes.get('rd-context-rows').innerHTML,/0\/1 displayed expiries/);
 assert.match(h.nodes.get('rd-context-rows').innerHTML,/1\/2 rows/);
});


test('selected-index futures metrics never borrow a fixed row from another index',()=>{
 const h=harness();h.nodes.get('op-one-stop').dataset.osSource='LIVE';
 h.futures(['Instrument','LTP','Day %','PDH','PDC','PDL','15m H','15m L','OI','Basis'],[
  ['NIFTY Spot','22757.8','0','—','—','—','—','—','—','—'],
  ['NIFTY Futures','22764.9','0','—','—','—','—','—','100','7.1'],
  ['BANKNIFTY Spot','54383.75','0','—','—','—','—','—','—','—'],
  ['BANKNIFTY Futures','54392.6','0','—','—','—','—','—','200','8.85']]);
 h.select('BANKNIFTY');const metrics=h.nodes.get('rd-market-metrics').innerHTML;
 assert.match(metrics,/54392.6/);assert.match(metrics,/8.85/);assert.doesNotMatch(metrics,/22764.9/);
 assert.doesNotMatch(h.nodes.get('rd-levels-table').innerHTML,/>(?:NIFTY Spot|NIFTY Futures)</);
});

test('compact PCR table separates fresh, reported and band observations without fake columns',()=>{
 const h=harness();
 h.source('os-wall-ladder',['Index / expiry','Full PCR / band','CE OI / Δ','PE OI / Δ','CE / PE wall','Fresh futures OI','PCR Δ'],[
  ['NIFTY','— / 1.1234','20,000 Δ +150','25,000 Δ -70','23,000 / 22,800','1,000','—'],
 ]);
 h.pcr('NIFTY','—','1.0969');
 const output=h.nodes.get('rd-pcr-table').innerHTML;
 assert.match(output,/<th>Fresh Full PCR<\/th>/);
 assert.match(output,/<th>Reported Full · mixed times<\/th>/);
 assert.match(output,/<th>ATM ±7 PCR<\/th>/);
 assert.match(output,/Reported 1.0969 · MIXED SOURCE TIMES/);
 assert.match(output,/1.1234/);
 assert.match(output,/\+150/);
 assert.match(output,/-70/);
 assert.doesNotMatch(output,/<th>±5 PCR<\/th>|<th>±3 PCR<\/th>|<th>Trend<\/th>/);
 h.pcr('NIFTY','1.0876',null);
 const fresh=h.nodes.get('rd-pcr-table').innerHTML;
 assert.match(fresh,/1.0876/);
 assert.doesNotMatch(fresh,/Reported 1.0969/);
});

test('tracked participation rows do not pretend weights or index-point contributions exist',()=>{
 const h=harness();
 h.source('os-stock-ranks',['#','Stock','Weight %','Price','Day %','Contribution','Trend','Quote time · IST','RAG / similar event'],[
  ['1','RELIANCE','—','₹ 1,200','+1.25%','—','▲','12:14:30','Unmatched'],
 ]);
 const output=h.nodes.get('rd-stock-table').innerHTML;
 for(const label of ['Tracked stock','Price','Day %','Direction','Quote IST'])assert(output.includes('<th>'+label+'</th>'));
 assert.match(output,/RELIANCE/);
 assert.match(output,/12:14:30/);
 assert.match(output,/Tracked market-wide quotes · unweighted ranking/);
 assert.doesNotMatch(output,/<th>Weight %<\/th>|<th>Contribution<\/th>|<th>RAG<\/th>/);
});

test('live events project the four observed source columns only',()=>{
 const h=harness();h.nodes.get('op-one-stop').dataset.osSource='LIVE';
 h.source('os-events',['Time · IST','Index','Event','Verified observation'],[
  ['12:14:30','NIFTY','ABOVE PDH','Spot 23,100 · exchange 12:14:30'],
 ]);
 const output=h.nodes.get('rd-event-table').innerHTML;
 assert.match(output,/ABOVE PDH/);
 assert.match(output,/Spot 23,100/);
 assert.doesNotMatch(output,/<th>PCR<\/th>|<th>OI<\/th>|<th>RAG<\/th>|<th>Similar Event<\/th>/);
});

test('mobile defaults to readable 1:1 flowing layout, and user can restore Fit page',()=>{
 const h=harness(390),page=h.nodes.get('rd-page'),viewport=h.nodes.get('rd-viewport');
 assert.equal(viewport.dataset.readable,'true');
 assert.equal(viewport.dataset.scale,'1');
 assert.equal(page.style.position,'relative');
 assert.equal(page.style.width,'100%');
 assert.equal(page.style.transform,'none');
 assert.equal(viewport.style.overflowX,'hidden');
 h.fitMode('PAGE');
 assert.equal(viewport.dataset.readable,'false');
 assert.match(page.style.transform,/^scale\(/);
 assert.equal(page.style.position,'absolute');
 assert.equal(page.style.width,'1024px');
 h.fitMode('READABLE');
 assert.equal(viewport.dataset.readable,'true');
 assert.equal(page.style.width,'100%');
 assert.equal(page.style.transform,'none');
});

test('desktop retains original 1024px reference fit unless Read is chosen',()=>{
 const h=harness(1024);
 assert.equal(h.nodes.get('rd-viewport').dataset.readable,'false');
 assert.equal(h.nodes.get('rd-page').style.width,'1024px');
 h.fitMode('READABLE');
 assert.equal(h.nodes.get('rd-viewport').dataset.readable,'true');
 assert.equal(h.nodes.get('rd-page').style.position,'relative');
});

test('mobile Read mode preserves source tables in individually scrollable containers',()=>{
 assert.match(SCREEN_OVERVIEW_HTML,/data-rd-fit="READABLE"/);
 assert.match(SCREEN_OVERVIEW_CSS,/#rd-viewport\[data-readable=true\]/);
 assert.match(SCREEN_OVERVIEW_CSS,/overflow-x:auto;overscroll-behavior-x:contain/);
 assert.match(SCREEN_OVERVIEW_CSS,/#rd-market-context\{grid-template-columns:minmax\(0,1fr\)/);
 assert.match(SCREEN_OVERVIEW_CSS,/font-size:12px;padding:8px 6px/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { installScreenOverview } from '../screen-overview.js';

function harness() {
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
  const reference = node({ dataset: { recordedIndex: 'NIFTY', referenceFrom: '2026-10-27T06:03:00Z', referenceAt: '2026-10-27T06:06:00Z' } });
  nodes.set('mb-page', node({ querySelector: (selector: string) => selector.includes('Recorded notable events') ? events :
    selector.includes('Recorder memory and replay') ? memory : selector.includes('Three-index recorded overview') ? reference : null }));
  nodes.set('rd-page', node({ scrollHeight: 700 }));
  nodes.set('rd-viewport', node({ clientWidth: 1024, clientHeight: 800 }));
  for (const id of ['rd-market-head','rd-market-levels','rd-market-metrics','rd-levels-table','rd-pcr-table',
    'rd-premium-table','rd-stock-table','rd-sector-table','rd-event-table','rd-memory-table','rd-context-rows',
    'rd-source','rd-fit-tools','rd-source-tables','rd-return','rd-settings','os-screen-close','os-screen-detail','os-screen-detail-body']) {
    nodes.set(id, node());
  }
  const context: any = { document: { getElementById: (id: string) => nodes.get(id),
    body: { dataset: {} }, createElement: () => node(), querySelectorAll: () => [], addEventListener() {} },
    window: { addEventListener() {} }, MutationObserver: class { observe() {} },
    __name: (fn: any) => fn, requestAnimationFrame: () => 1 };
  const installer = vm.runInNewContext(`(${installScreenOverview.toString()})`, context);
  const view = installer();
  return { nodes, events, memory, reference, futures(heads:string[],rows:string[][]){nodes.set('os-future-response',tableSource(heads,rows));view.refresh();}, headline(value:string,status:string){price=value;validation=status;view.refresh();}, premium(heads:string[],rows:string[][]){nodes.set('os-premium-table',tableSource(heads,rows));view.refresh();}, select(symbol: string) { selected = symbol; view.refresh(); } };
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


test('comparison reference retains full date and IST clocks without promising synchronized replay',()=>{
 const h=harness(),output=h.nodes.get('rd-context-rows').innerHTML;
 assert.match(output,/Comparison reference/);assert.match(output,/27 Oct 2026/);
 assert.match(output,/11:33:00/);assert.match(output,/11:36:00/);
 assert.match(output,/synchronized replay unavailable/);
 h.select('SENSEX');assert.doesNotMatch(h.nodes.get('rd-context-rows').innerHTML,/11:36:00/);
 assert.match(h.nodes.get('rd-context-rows').innerHTML,/Unavailable → Unavailable/);
});
test('missing or malformed reference endpoints are never replaced by headline clocks',()=>{
 const h=harness();h.reference.dataset.referenceFrom='';h.reference.dataset.referenceAt='garbage';h.select('NIFTY');
 assert.match(h.nodes.get('rd-context-rows').innerHTML,/Unavailable → Unavailable/);
 assert.doesNotMatch(h.nodes.get('rd-context-rows').innerHTML,/11:36:00/);
});
test('recorded section clocks explain independent and retrospective evidence',()=>{
 const h=harness();
 assert.match(h.nodes.get('rd-levels-table').innerHTML,/simultaneous observations are unverified/);
 assert.match(h.nodes.get('rd-premium-table').innerHTML,/missing clock stays unavailable/);
 assert.match(h.nodes.get('rd-event-table').innerHTML,/not event-time knowledge/);
 assert.match(h.nodes.get('rd-memory-table').innerHTML,/not a synchronized replay frame/);
 h.nodes.get('op-one-stop').dataset.osSource='LIVE';h.select('NIFTY');
 assert.doesNotMatch(h.nodes.get('rd-context-rows').innerHTML,/Comparison reference/);
 assert.doesNotMatch(h.nodes.get('rd-premium-table').innerHTML,/Source clocks/);
});

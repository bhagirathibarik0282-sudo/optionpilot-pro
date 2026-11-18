import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { BNF_SHADOW_CARD_CSS, BNF_SHADOW_CARD_HTML, BNF_SHADOW_CARD_SCRIPT } from '../bnf-shadow-status-card.js';

test('BANKNIFTY shadow card is display-only and retains unverified paper journal labels', () => {
  assert.match(BNF_SHADOW_CARD_HTML, /PAPER ONLY · NO BROKER ORDERS/);
  assert.match(BNF_SHADOW_CARD_HTML, /Paper entry \/ partial fill \/ exit: <b>UNVERIFIED<\/b>/);
  assert.match(BNF_SHADOW_CARD_CSS, /#bnf-shadow-card/);
  assert.match(BNF_SHADOW_CARD_SCRIPT, /bnf-shadow-paper-status/);
  assert.match(BNF_SHADOW_CARD_SCRIPT, /paper entry and exit unverified/i);
  assert.doesNotMatch(BNF_SHADOW_CARD_SCRIPT, /\/api\/orders|placeOrder|submitOrder|sendTelegram/);
});

async function render(state: any, ok=true) {
  const nodes = new Map<string,{textContent:string}>();
  const element=(id:string) => {
    if(!nodes.has(id))nodes.set(id,{textContent:''});
    return nodes.get(id)!;
  };
  const context={
    document:{getElementById:element,visibilityState:'visible'},
    window:{addEventListener:()=>{}},
    setTimeout:()=>1,clearTimeout:()=>{},setInterval:()=>{},
    AbortController, Date, Number, String, Error,
    fetch:async()=>({ok,json:async()=>({mode:'BNF_PAPER_SHADOW_STATUS_V1',readOnly:true,brokerOrders:0,host:state})}),
  };
  if(!ok)context.fetch=async()=>({ok:false,json:async()=>({})});
  vm.runInNewContext(BNF_SHADOW_CARD_SCRIPT,context);
  for(let i=0;i<15;i++)await Promise.resolve();
  return element;
}

test('live worker counter freshness and paper proofs are kept separate', async()=>{
  const base={enabled:true,phase:'READY',reason:'WAIT_EXACT_180S_WARMUP',childRunning:true,
    feedConnected:true,relay:{accepted:24},sourceCounts:{observations:12,signals:0,rejected:3}};
  let node=await render({...base,sourceUpdatedAt:new Date().toISOString()});
  assert.equal(node('bnf-worker').textContent,'READY');
  assert.equal(node('bnf-observations').textContent,'12');
  assert.equal(node('bnf-signals').textContent,'0');
  node=await render({...base,sourceUpdatedAt:new Date(Date.now()-120000).toISOString()});
  assert.equal(node('bnf-observations').textContent,'—');
  assert.equal(node('bnf-signals').textContent,'—');
  node=await render({...base,feedConnected:false});
  assert.equal(node('bnf-worker').textContent,'NOT READY');
  assert.equal(node('bnf-signals').textContent,'—');
});

test('HTTP failure never displays stale success',async()=>{
  const node=await render({},false);
  assert.match(node('bnf-phase').textContent,/unavailable/);
  assert.equal(node('bnf-signals').textContent,'—');
});

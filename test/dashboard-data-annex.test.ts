import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../research-server-hook.ts", import.meta.url), "utf8");

test("same-page DATA annex reuses the existing read-only observation terminal", () => {
  assert.match(source, /OPTIONPILOT_DATA_ANNEX_V1/);
  assert.match(source, /const BUSINESS_DATA_HREF = "\/api\/research\/business-dashboard\/view\?symbol=NIFTY";/);
  assert.match(source, /id="optionpilot-data-annex-open"/);
  assert.match(source, /id="optionpilot-data-annex-shell"/);
  assert.match(source, /id="optionpilot-data-annex-frame"/);
  assert.match(source, /src="about:blank"/);
  assert.match(source, /data-src="\$\{BUSINESS_DATA_HREF\}"/);
  assert.match(source, /id="optionpilot-data-annex-close"/);
  assert.match(source, /document\.body\.style\.overflow = "hidden"/);
  assert.match(source, /event\.key === "Escape"/);
});

test("annex preserves the existing research shortcuts and adds no new data authority", () => {
  assert.match(source, /data-optionpilot-theory-lab-shortcut="true"/);
  assert.match(source, /data-optionpilot-intelligence-shortcut="true"/);
  assert.doesNotMatch(source, /optionpilot-data-annex[^\n]*(POST|PUT|PATCH|DELETE)/);
  assert.doesNotMatch(source, /DATA_ANNEX_(SELECTOR|ORDER|TELEGRAM|DATABASE)/);
});

test("ONE STOP is the only floating launcher; Theory Lab and Intelligence are accessible from the compact Tools menu", () => {
  const start=source.indexOf("const shortcut = `"),end=source.indexOf("`;",start);
  const shell=source.slice(start,end);
  assert(start>=0&&end>start);
  assert.equal((shell.match(/position:fixed/g)||[]).length,2,"single floating ONE STOP button plus full-screen dialog");
  assert.equal((shell.match(/data-optionpilot-data-annex="true"/g)||[]).length,1);
  assert.match(shell,/⚡ ONE STOP/);
  assert.match(shell,/id="optionpilot-tools-menu"/);
  assert.match(shell,/<nav aria-label="OptionPilot research tools"/);
  assert.match(shell,/data-optionpilot-theory-lab-shortcut="true"/);
  assert.match(shell,/data-optionpilot-intelligence-shortcut="true"/);
  assert.match(shell,/min-height:48px/);
  assert.match(shell,/safe-area-inset-bottom/);
  assert.match(shell,/aria-modal="true"/);
  assert.match(shell,/aria-expanded="false"/);
  assert.match(shell,/if \(tools && tools.open\) tools.open = false/);
});
test("DATA iframe route cannot acquire nested ONE STOP launcher or duplicated navigation",()=>{
 assert.match(source,/c\.req\.path === "\/api\/research\/business-dashboard\/view"/);
 assert.match(source,/html\.includes\("id=\\\"optionpilot-data-annex-open\\\""/);
 assert.match(source,/src="\$\{BUSINESS_DATA_HREF\}"/);
 assert.doesNotMatch(source,/setInterval\(.*optionpilot-data-annex/);
});

test("single launcher inline browser code parses with no market fetch or order authority",()=>{
 const at=source.indexOf('const shortcut = `'),from=source.indexOf('<script>',at),to=source.indexOf('</script>',from);
 assert(from>=0&&to>from);
 const script=source.slice(from+8,to);
 assert.doesNotThrow(()=>new vm.Script(script));
 assert.doesNotMatch(script,/\bfetch\s*\(|EventSource|WebSocket|placeOrder|submitOrder/);
});

test("ONE STOP initializes its iframe only upon first open and preserves it on close/reopen",()=>{
 const at=source.indexOf('const shortcut = `'),from=source.indexOf('<script>',at),to=source.indexOf('</script>',from);
 assert(at>=0&&from>=0&&to>from);
 const attrs:Record<string,string>={src:'about:blank'},listeners:Record<string,Function>={};
 const button=(name:string)=>({handlers:{} as Record<string,Function>,setAttribute(key:string,value:string){attrs[name+'_'+key]=value;},focus(){},
  addEventListener(type:string,fn:Function){this.handlers[type]=fn;}});
 const open=button('open'),close=button('close'),shell={hidden:true},tools={open:false};
 const frame={dataset:{src:'/api/research/business-dashboard/view?symbol=NIFTY'},writes:0,
  getAttribute(key:string){return attrs[key];},
  setAttribute(key:string,value:string){attrs[key]=value;this.writes++;}};
 const nodes:Record<string,any>={'optionpilot-data-annex-open':open,'optionpilot-data-annex-shell':shell,
  'optionpilot-data-annex-close':close,'optionpilot-tools-menu':tools,'optionpilot-data-annex-frame':frame};
 const document:any={body:{style:{overflow:''}},getElementById(id:string){return nodes[id];},
  addEventListener(type:string,fn:Function){listeners[type]=fn;}};
 vm.runInNewContext(source.slice(from+8,to),{document});
 assert.equal(frame.writes,0,'homepage must never start DATA network requests before opening ONE STOP');
 open.handlers.click();assert.equal(shell.hidden,false);assert.equal(frame.writes,1);
 assert.equal(attrs.src,frame.dataset.src);assert.equal(document.body.style.overflow,'hidden');
 close.handlers.click();assert.equal(shell.hidden,true);assert.equal(frame.writes,1,'closing must not reload DATA or forget selected contract');
 assert.equal(document.body.style.overflow,'');
 open.handlers.click();assert.equal(frame.writes,1,'reopening must reuse the same iframe and preserve session state');
 tools.open=true;listeners.keydown({key:'Escape'});assert.equal(tools.open,false);assert.equal(shell.hidden,false);
 listeners.keydown({key:'Escape'});assert.equal(shell.hidden,true);
});

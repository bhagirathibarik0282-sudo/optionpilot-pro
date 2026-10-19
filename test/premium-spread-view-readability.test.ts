import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { renderPremiumSpreadView } from "../premium-spread-view.js";

const view = renderPremiumSpreadView();
test("plain-language premium view has % chart and individual 1m legs", () => {
  assert.match(view, /CE Δ1m/);
  assert.match(view, /PE Δ1m/);
  assert.match(view, /Gap Δ1m/);
  assert.match(view, /First 30 verified minutes/);
  assert.match(view, /Different strikes/);
  assert.match(view, /No invented minutes/);
  assert.doesNotMatch(view, /BUY NOW|SELL NOW/);
  assert.doesNotThrow(() => new vm.Script(view.split("<script>")[1].split("</script>")[0]));
});

test("recorded 19 Oct pair becomes clear CE up and PE down, without promoting raw observations", async () => {
  const elements = new Map<string, any>();
  function element(id: string) {
    if (!elements.has(id)) elements.set(id, {
      id, innerHTML: "", textContent: "", value: "",
      disabled: false, hidden: false, dataset: {},
      querySelector: () => ({ disabled: false }),
      setAttribute() {},
    });
    return elements.get(id);
  }
  const form = element("f");
  form.requestSubmit = () => { void form.onsubmit({ preventDefault() {} }); };
  const mockData = {
    ok: true,
    request: { date: "2026-10-19", symbol: "NIFTY", ce: 22900, pe: 23150, expiry: "2026-10-19" },
    counts: { TRUE_ELIGIBLE_BOTH: 1, TRUE_DIAGNOSTIC: 1, UNMARKED: 1 },
    rows: [
      { timeIst: "09:15", status: "UNMARKED", ceLtp: 216.05, peLtp: 107.75, gap: 108.30, change1m: null },
      { timeIst: "09:32", status: "TRUE_ELIGIBLE_BOTH", ceLtp: 158.30, peLtp: 156.35, gap: 1.95, change1m: null },
      { timeIst: "09:33", status: "TRUE_DIAGNOSTIC", ceLtp: 201, peLtp: 127.85, gap: 73.15, change1m: 71.20 },
    ],
  };
  const document = {
    getElementById: element,
    querySelectorAll: () => [] as any[],
  };
  class FormDataMock { *[Symbol.iterator]() { yield ["date", "2026-10-19"]; } }
  const script = view.split("<script>")[1].split("</script>")[0];
  vm.runInNewContext(script, {
    document, FormData: FormDataMock, URLSearchParams,
    fetch: async () => ({ ok: true, json: async () => mockData }),
  }, { timeout: 1000 });
  for (let i = 0; i < 8; i++) await Promise.resolve();
  assert.equal(element("output").hidden, false);
  assert.match(element("story").innerHTML, /09:32 → 09:33 IST/);
  assert.match(element("story").innerHTML, /CE ↑ ₹42\.70/);
  assert.match(element("story").innerHTML, /PE ↓ ₹28\.50/);
  assert.match(element("story").innerHTML, /71\.20/);
  assert.match(element("chart").innerHTML, /#51e9b1/);
  assert.match(element("chart").innerHTML, /#ff879d/);
  assert.doesNotMatch(element("rows").innerHTML, /data-time="09:15"/, "default TRUE view must not promote raw rows");
  assert.match(element("rows").innerHTML, /TRUE_ELIGIBLE_BOTH/);
  assert.match(element("rows").innerHTML, /TRUE_DIAGNOSTIC/);
  assert.equal(mockData.rows[0].status, "UNMARKED");
});

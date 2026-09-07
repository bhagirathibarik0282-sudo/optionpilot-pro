import fs from "node:fs";
import path from "node:path";

const file = path.resolve(process.cwd(), "research-router.ts");
const checkOnly = process.argv.includes("--check");
let src = fs.readFileSync(file, "utf8");
const original = src;

function replaceOnce(from, to, label) {
  const count = src.split(from).length - 1;
  if (count === 0 && src.includes(to)) return;
  if (count !== 1) throw new Error(`${label}: expected exactly 1 source occurrence, found ${count}`);
  src = src.replace(from, to);
}

const anchorImport = 'import { buildH1LiveDteShadowComparison } from "./h1-live-dte-shadow-comparison-v1.js";';
const forwardImport = 'import { runMarketForwardTestReadinessHttp } from "./market-forward-test-readiness-http-v1.js";';
if (!src.includes(forwardImport)) {
  replaceOnce(anchorImport, `${anchorImport}\n${forwardImport}`, "forward-test readiness import");
}

const anchorRoute = 'researchRouter.get("/meaningful-live-acceptance", async (c) => {';
const forwardRoute = `researchRouter.get("/market-forward-test-readiness", async (c) => {
  c.header("Cache-Control", "no-store");
  const result = await runMarketForwardTestReadinessHttp({
    symbol: c.req.query("symbol"),
    tradeDate: c.req.query("date"),
    fromTime: c.req.query("from"),
    toTime: c.req.query("to"),
  });
  return c.json(result.body, result.status);
});

`;
if (!src.includes('researchRouter.get("/market-forward-test-readiness"')) {
  replaceOnce(anchorRoute, `${forwardRoute}${anchorRoute}`, "forward-test readiness route");
}

if (checkOnly) {
  console.log(src === original ? "market forward-test readiness runtime wiring already applied" : "market forward-test readiness runtime wiring check passed");
  process.exit(0);
}

if (src !== original) {
  fs.writeFileSync(file, src, "utf8");
  console.log("market forward-test readiness runtime wiring applied");
} else {
  console.log("market forward-test readiness runtime wiring already applied");
}

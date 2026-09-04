import { runH1ExactLiveContractDiscoveryHttp } from "./h1-exact-live-contract-discovery-http.js";

const asOfDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kolkata",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());

setTimeout(() => {
  void runH1ExactLiveContractDiscoveryHttp({
    symbols: "NIFTY,SENSEX,BANKNIFTY",
    asOfDate,
  })
    .then((result) => {
      console.log(`[H1_EXACT_LIVE_CONTRACT_DISCOVERY_STARTUP_AUDIT] ${JSON.stringify(result)}`);
    })
    .catch((err) => {
      console.error(`[H1_EXACT_LIVE_CONTRACT_DISCOVERY_STARTUP_AUDIT] ${JSON.stringify({
        ok: false,
        mode: "READ_ONLY_H1_EXACT_LIVE_CONTRACT_DISCOVERY_V1",
        productionImpact: "NONE",
        blockers: [err instanceof Error ? err.message : "STARTUP_AUDIT_FAILED"],
        rows: [],
      })}`);
    });
}, 2500).unref?.();

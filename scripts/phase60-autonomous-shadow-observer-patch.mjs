import { readFileSync, writeFileSync } from "node:fs";

const path = "server.ts";
const marker = "PHASE60_AUTONOMOUS_SHADOW_OBSERVER_V1";
const source = readFileSync(path, "utf8");

if (source.includes(marker)) {
  console.log(`[Phase60] ${marker} already present; no change.`);
  process.exit(0);
}

const anchor = `      if (!session.snapshotTime || Date.now() - session.snapshotTime >= effectiveTtl) {
        void refreshMarketSnapshot(session).catch((err) => {
          console.error(
            "[BACKGROUND] Market refresh failed:",
            err instanceof Error ? err.message : err
          );
        });
      }`;

if (!source.includes(anchor)) {
  throw new Error("[Phase60] Source drift: exact background refresh anchor not found; refusing to patch.");
}

const replacement = `      if (!session.snapshotTime || Date.now() - session.snapshotTime >= effectiveTtl) {
        void refreshMarketSnapshot(session)
          .then((snapshot) => {
            // PHASE60_AUTONOMOUS_SHADOW_OBSERVER_V1
            // Research-shadow only. Reuses the exact already-fetched canonical
            // market snapshot. No extra Kite fetch, no score/verdict mutation,
            // no Telegram/execution path, and persistence remains gated by the
            // existing PHASE50_SCORE_SHADOW flag inside the observer path.
            if (!/^(1|true|yes|on)$/i.test(String(process.env.PHASE50_SCORE_SHADOW ?? ""))) return;
            try {
              for (const symbol of ["NIFTY", "BANKNIFTY", "SENSEX"] as const) {
                const m = snapshot[symbol];
                if (!m || m.error) continue;
                serverComputePcrTrendValueCached.set(symbol, serverComputePcrTrendValue(session, symbol));
                // Deliberately do NOT issue a sector/API fetch here. The existing
                // server validator receives null for unavailable sector breadth and
                // fails closed if that input is mandatory. Phase59 trace then makes
                // the exact blocker observable instead of fabricating a value.
                const validation = validateDataServer(symbol, m, session, null);
                runRuleEngineServer(symbol, m, validation, null);
              }
            } catch (err) {
              console.error(
                "[Phase60] autonomous shadow observer failed:",
                err instanceof Error ? err.message : err
              );
            }
          })
          .catch((err) => {
            console.error(
              "[BACKGROUND] Market refresh failed:",
              err instanceof Error ? err.message : err
            );
          });
      }`;

const next = source.replace(anchor, replacement);

for (const required of [
  marker,
  "refreshMarketSnapshot(session)",
  "validateDataServer(symbol, m, session, null)",
  "runRuleEngineServer(symbol, m, validation, null)",
  "PHASE50_SCORE_SHADOW",
]) {
  if (!next.includes(required)) throw new Error(`[Phase60] Verification failed: missing ${required}`);
}

if (next.includes("fetchSectorHeatmapData(session.accessToken)\n                const validation")) {
  throw new Error("[Phase60] Safety check failed: unexpected extra sector fetch in observer block.");
}

writeFileSync(path, next, "utf8");
console.log(`[Phase60] Applied ${marker}.`);

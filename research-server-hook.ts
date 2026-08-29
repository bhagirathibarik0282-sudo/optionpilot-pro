import type { Hono } from "hono";
import { researchRouter } from "./research-router.js";
import { installTelegramCombinationBridge } from "./telegram-combination-bridge.js";
import { runH1PilotHttpAudit } from "./h1-pilot-audit-http.js";

const INTELLIGENCE_LAYER_HREF = "/api/research/broad-market-size/view";

// server.ts already imports this bootstrap module at process start. Install the
// display-only Telegram evidence bridge here so the existing 1-minute sender
// can surface COMB-01..08 without changing its verdict, score, cadence, or
// execution logic. The bridge is idempotent and fail-closed.
installTelegramCombinationBridge();

// Railway MCP can read service logs but cannot safely execute one-off commands
// or perform an outbound GET to the research endpoint. Emit the exact same
// read-only H1 pilot audit once after startup so runtime evidence is observable
// without changing Railway config, exposing credentials, or writing to DB.
const h1StartupAuditTimer = setTimeout(() => {
  void runH1PilotHttpAudit()
    .then((result) => console.log(`[H1_PILOT_STARTUP_AUDIT] ${JSON.stringify(result)}`))
    .catch((err) => console.error(`[H1_PILOT_STARTUP_AUDIT] ${JSON.stringify({
      ok: false,
      mode: "READ_ONLY_H1_PILOT_AUDIT",
      productionImpact: "NONE",
      audit: null,
      reason: err instanceof Error ? err.message : "H1_PILOT_STARTUP_AUDIT_FAILED",
    })}`));
}, 5000);
h1StartupAuditTimer.unref?.();

/**
 * Mounts research-only endpoints without changing any production verdict,
 * scoring, or trading execution path. The separately installed Telegram
 * bridge above is display-only: it appends evidence but never changes action.
 *
 * Intended server.ts integration:
 *   mountResearchRoutes(app);
 */
export function mountResearchRoutes(app: Hono): void {
  // UI-only middleware: after the existing main dashboard renders, inject a
  // small floating shortcut to the already-existing Intelligence Layer page.
  app.use("/", async (c, next) => {
    await next();

    if (c.req.method !== "GET") return;
    const response = c.res;
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html")) return;

    const html = await response.text();
    if (!html.includes("</body>") || html.includes("data-optionpilot-intelligence-shortcut")) return;

    const shortcut = `
      <a
        data-optionpilot-intelligence-shortcut="true"
        href="${INTELLIGENCE_LAYER_HREF}"
        aria-label="Open Intelligence Layer"
        style="position:fixed;right:12px;bottom:62px;z-index:9999;display:inline-flex;align-items:center;gap:7px;padding:10px 14px;border:1px solid rgba(0,255,200,.55);border-radius:999px;background:rgba(8,18,24,.94);color:#55ffd8;text-decoration:none;font:700 12px/1.1 system-ui,-apple-system,Segoe UI,sans-serif;letter-spacing:.02em;box-shadow:0 0 18px rgba(0,255,200,.18);backdrop-filter:blur(8px)">
        <span aria-hidden="true">✦</span>
        <span>Intelligence Layer</span>
      </a>
    `;

    const headers = new Headers(response.headers);
    headers.delete("content-length");
    c.res = new Response(html.replace("</body>", `${shortcut}</body>`), {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  });

  app.route("/api/research", researchRouter);
}

export const RESEARCH_ROUTE_BASE = "/api/research" as const;
export const RESEARCH_ROUTE_SAFETY = {
  mode: "RESEARCH_MODE",
  productionImpact: "NONE",
  affectsVerdict: false,
  affectsTelegram: false,
  affectsExecution: false,
} as const;

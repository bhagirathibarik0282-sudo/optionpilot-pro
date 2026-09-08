import type { Context } from "hono";
import { parseH1ReplayRequest, runH1ReplayHttp } from "./h1-replay-http.js";
import { buildH1Dte0TransitionCalibration } from "./h1-dte0-transition-calibration-v1.js";
import { runH1Dte0MultidayOos } from "./h1-dte0-multiday-oos-v1.js";

export async function runH1Dte0MultidayOosHttp(c: Context) {
  c.header("Cache-Control", "no-store");
  const symbol = c.req.query("symbol") ?? "NIFTY";
  const dates = String(c.req.query("dates") ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

  if (dates.length < 4 || dates.length > 20) {
    return c.json({
      ok: false,
      mode: "H1_DTE0_MULTIDAY_OOS_V1",
      productionImpact: "NONE",
      reason: "DATES_REQUIRE_4_TO_20",
      safety: {
        readOnly: true,
        affectsSelector: false,
        affectsTelegram: false,
        affectsVerdict: false,
        affectsExecution: false,
        thresholdPromoted: false,
        dte0ThresholdInvented: false,
        failClosed: true,
      },
    }, 400);
  }

  const days = [];
  for (const tradeDate of dates) {
    const parsed = parseH1ReplayRequest({
      symbol,
      tradeDate,
      fromTime: c.req.query("from") ?? "09:15",
      toTime: c.req.query("to") ?? "15:30",
      scope: c.req.query("scope") ?? "CORE",
    });
    if (!parsed.ok) {
      return c.json({
        ok: false,
        mode: "H1_DTE0_MULTIDAY_OOS_V1",
        productionImpact: "NONE",
        reason: parsed.reason,
        tradeDate,
      }, 400);
    }

    const replay = await runH1ReplayHttp(parsed.value);
    if (!replay.ok) {
      return c.json({
        ok: false,
        mode: "H1_DTE0_MULTIDAY_OOS_V1",
        productionImpact: "NONE",
        reason: replay.reason,
        tradeDate,
      }, replay.reason === "DATABASE_URL_NOT_CONFIGURED" ? 200 : 503);
    }

    days.push({
      tradeDate,
      calibration: buildH1Dte0TransitionCalibration(parsed.value, replay),
    });
  }

  return c.json(runH1Dte0MultidayOos(days));
}

import type { Hono } from "hono";
import { researchRouter } from "./research-router.js";

/**
 * Mounts research-only endpoints without changing any production verdict,
 * scoring, Telegram, or trading execution path.
 *
 * Intended server.ts integration:
 *   mountResearchRoutes(app);
 */
export function mountResearchRoutes(app: Hono): void {
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

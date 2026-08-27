import { readFileSync } from "node:fs";

const REPORT_PATH = "/tmp/dhan-audit-result.json";

export function mountDhanAuditStatusRoute(app: any) {
  app.get("/api/research/dhan-audit-status", (c: any) => {
    try {
      const raw = readFileSync(REPORT_PATH, "utf8");
      const report = JSON.parse(raw);
      return c.json({ ok: true, ...report }, 200);
    } catch (err) {
      return c.json({
        ok: false,
        status: "NOT_READY",
        error: "Audit result not available yet",
        detail: err instanceof Error ? err.message : String(err),
      }, 200);
    }
  });
}

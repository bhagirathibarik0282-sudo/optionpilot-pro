import test from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { researchRouter } from "../research-router.js";

function appWithResearchRouter() {
  const app = new Hono();
  app.route("/api/research", researchRouter);
  return app;
}

test("research mutation endpoints are disabled when admin token is not configured", async () => {
  const previous = process.env.RESEARCH_ADMIN_TOKEN;
  delete process.env.RESEARCH_ADMIN_TOKEN;
  try {
    const app = appWithResearchRouter();
    const res = await app.request("http://localhost/api/research/broad-market-size/rebuild-metrics", {
      method: "POST",
    });
    assert.equal(res.status, 503);
    const body = await res.json() as { reason?: string };
    assert.equal(body.reason, "RESEARCH_MUTATIONS_DISABLED");
  } finally {
    if (previous === undefined) delete process.env.RESEARCH_ADMIN_TOKEN;
    else process.env.RESEARCH_ADMIN_TOKEN = previous;
  }
});

test("research mutation endpoints reject an invalid admin token", async () => {
  const previous = process.env.RESEARCH_ADMIN_TOKEN;
  process.env.RESEARCH_ADMIN_TOKEN = "expected-secret";
  try {
    const app = appWithResearchRouter();
    const res = await app.request("http://localhost/api/research/broad-market-size/rebuild-metrics", {
      method: "POST",
      headers: { "x-research-admin-token": "wrong-secret" },
    });
    assert.equal(res.status, 403);
    const body = await res.json() as { reason?: string };
    assert.equal(body.reason, "RESEARCH_MUTATION_FORBIDDEN");
  } finally {
    if (previous === undefined) delete process.env.RESEARCH_ADMIN_TOKEN;
    else process.env.RESEARCH_ADMIN_TOKEN = previous;
  }
});

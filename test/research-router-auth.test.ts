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


test("read-only DTE-aware shadow threshold route is exposed without mutation authority", async () => {
  const source = await import("../research-router.js");
  const paths = source.researchRouter.routes.map((route) => route.path);
  assert.ok(paths.includes("/h1-dte-aware-shadow-threshold"));
});


test("Jev shadow run is protected by existing research admin token", async () => {
  const previousAdmin = process.env.RESEARCH_ADMIN_TOKEN;
  const previousOpenRouter = process.env.OPENROUTER_API_KEY;
  process.env.RESEARCH_ADMIN_TOKEN = "expected-secret";
  delete process.env.OPENROUTER_API_KEY;
  try {
    const app = appWithResearchRouter();

    const forbidden = await app.request("http://localhost/api/research/jev-decision-shadow/run", {
      method: "POST",
      headers: { "content-type": "application/json", "x-research-admin-token": "wrong-secret" },
      body: JSON.stringify({ limit: 1, symbol: "NIFTY" }),
    });
    assert.equal(forbidden.status, 403);

    const authorized = await app.request("http://localhost/api/research/jev-decision-shadow/run", {
      method: "POST",
      headers: { "content-type": "application/json", "x-research-admin-token": "expected-secret" },
      body: JSON.stringify({ limit: 1, symbol: "NIFTY" }),
    });
    assert.equal(authorized.status, 503);
    const body = await authorized.json() as { blocker?: string };
    assert.equal(body.blocker, "OPENROUTER_API_KEY_REQUIRED");
  } finally {
    if (previousAdmin === undefined) delete process.env.RESEARCH_ADMIN_TOKEN;
    else process.env.RESEARCH_ADMIN_TOKEN = previousAdmin;
    if (previousOpenRouter === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previousOpenRouter;
  }
});

test("Jev shadow status exposes configuration state but never the secret", async () => {
  const previous = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = "super-secret-value";
  try {
    const app = appWithResearchRouter();
    const res = await app.request("http://localhost/api/research/jev-decision-shadow/status");
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.match(text, /"openRouterConfigured":true/);
    assert.doesNotMatch(text, /super-secret-value/);
  } finally {
    if (previous === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previous;
  }
});

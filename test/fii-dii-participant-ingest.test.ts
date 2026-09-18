import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyNseParticipantFetchFailure,
  fetchNseParticipantDerivatives,
  fetchNseParticipantDerivativesWithRetry,
  nseParticipantFetchAttempts,
  nseParticipantReportUrl,
  parseNseParticipantDerivativesCsv,
} from "../fii-dii-nse.js";

const HEADER = [
  "Client Type",
  "Future Index Long",
  "Future Index Short",
  "Future Stock Long",
  "Future Stock Short",
  "Option Index Call Long",
  "Option Index Put Long",
  "Option Index Call Short",
  "Option Index Put Short",
  "Option Stock Call Long",
  "Option Stock Put Long",
  "Option Stock Call Short",
  "Option Stock Put Short",
  "Total Long Contracts",
  "Total Short Contracts",
].join(",");

function participantCsv(overrides: Partial<Record<"Client" | "DII" | "FII" | "Pro", string>> = {}): string {
  const row = (name: "Client" | "DII" | "FII" | "Pro", start: number) =>
    overrides[name] ?? [name, ...Array.from({ length: 14 }, (_, i) => start + i)].join(",");
  return [
    '"Participant wise Open Interest (no. of contracts) in Equity Derivatives as on Sep 17,2026",,,,,,,,,,,,,,,',
    HEADER,
    row("Client", 1),
    row("DII", 101),
    row("FII", 201),
    row("Pro", 301),
    ["TOTAL", ...Array.from({ length: 14 }, (_, i) => 1000 + i)].join(","),
  ].join("\n");
}

test("builds official NSE participant report URLs from ISO trade date", () => {
  assert.equal(
    nseParticipantReportUrl("OI", "2026-09-17"),
    "https://nsearchives.nseindia.com/content/nsccl/fao_participant_oi_17092026.csv",
  );
  assert.equal(
    nseParticipantReportUrl("VOLUME", "17-09-2026"),
    "https://nsearchives.nseindia.com/content/nsccl/fao_participant_vol_17092026.csv",
  );
});

test("parses exactly CLIENT/DII/FII/PRO OI rows into persistence shape", () => {
  const rows = parseNseParticipantDerivativesCsv(
    participantCsv(),
    "OI",
    "2026-09-17",
    "https://nsearchives.nseindia.com/content/nsccl/fao_participant_oi_17092026.csv",
    "2026-09-17T11:00:00.000Z",
  );

  assert.deepEqual(rows.map((row) => row.participant), ["CLIENT", "DII", "FII", "PRO"]);
  assert.equal(rows[0].futureIndexLong, 1);
  assert.equal(rows[0].totalShortContracts, 14);
  assert.equal(rows[2].optionIndexCallLong, 205);
  assert.equal(rows[3].reportKind, "OI");
  assert.equal(rows[3].tradeDate, "2026-09-17");
});

test("same parser supports participant VOLUME report structure", () => {
  const rows = parseNseParticipantDerivativesCsv(
    participantCsv(),
    "VOLUME",
    "2026-09-17",
    "https://nsearchives.nseindia.com/content/nsccl/fao_participant_vol_17092026.csv",
  );
  assert.equal(rows.length, 4);
  assert.ok(rows.every((row) => row.reportKind === "VOLUME"));
});

test("fails closed when a required participant category is missing", () => {
  const csv = participantCsv().split("\n").filter((line) => !line.startsWith("DII,")).join("\n");
  assert.throws(
    () => parseNseParticipantDerivativesCsv(
      csv,
      "OI",
      "2026-09-17",
      "https://nsearchives.nseindia.com/content/nsccl/fao_participant_oi_17092026.csv",
    ),
    /NSE_PARTICIPANT_CATEGORIES_MISSING:DII/,
  );
});

test("fails closed on negative or non-integer contract counts", () => {
  const invalid = ["Client", -1, ...Array.from({ length: 13 }, (_, i) => i + 2)].join(",");
  assert.throws(
    () => parseNseParticipantDerivativesCsv(
      participantCsv({ Client: invalid }),
      "OI",
      "2026-09-17",
      "https://nsearchives.nseindia.com/content/nsccl/fao_participant_oi_17092026.csv",
    ),
    /INVALID_NSE_PARTICIPANT_FUTURE_INDEX_LONG/,
  );
});

test("fetch uses official URL and rejects HTML masquerading as report data", async () => {
  let requested = "";
  const fakeFetch = async (input: string | URL | Request) => {
    requested = String(input);
    return new Response("<html>blocked</html>", {
      status: 200,
      headers: { "content-type": "text/html" },
    });
  };

  await assert.rejects(
    () => fetchNseParticipantDerivatives("OI", "2026-09-17", fakeFetch as typeof fetch),
    /NSE_PARTICIPANT_OI_NON_CSV_RESPONSE/,
  );
  assert.equal(
    requested,
    "https://nsearchives.nseindia.com/content/nsccl/fao_participant_oi_17092026.csv",
  );
});

test("fetch returns four normalized rows from an official CSV response", async () => {
  const fakeFetch = async () => new Response(participantCsv(), {
    status: 200,
    headers: { "content-type": "text/csv" },
  });

  const rows = await fetchNseParticipantDerivatives("VOLUME", "2026-09-17", fakeFetch as typeof fetch);
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.map((row) => row.participant), ["CLIENT", "DII", "FII", "PRO"]);
  assert.ok(rows.every((row) => row.reportKind === "VOLUME"));
});


test("404 is classified as NOT_PUBLISHED_YET and is not retried", async () => {
  let attempts = 0;
  const fakeFetch = async () => {
    attempts += 1;
    return new Response("missing", { status: 404 });
  };

  let captured: unknown;
  try {
    await fetchNseParticipantDerivativesWithRetry(
      "OI",
      "2026-09-17",
      { retryCount: 3, baseDelayMs: 0 },
      fakeFetch as typeof fetch,
      async () => {},
    );
  } catch (error) {
    captured = error;
  }

  assert.ok(captured instanceof Error);
  assert.equal(classifyNseParticipantFetchFailure(captured), "NOT_PUBLISHED_YET");
  assert.equal(nseParticipantFetchAttempts(captured), 1);
  assert.equal(attempts, 1);
});

test("transient 5xx is retried with a bounded attempt count and then succeeds", async () => {
  let attempts = 0;
  const fakeFetch = async () => {
    attempts += 1;
    if (attempts < 3) return new Response("temporary", { status: 503 });
    return new Response(participantCsv(), {
      status: 200,
      headers: { "content-type": "text/csv" },
    });
  };

  const result = await fetchNseParticipantDerivativesWithRetry(
    "VOLUME",
    "2026-09-17",
    { retryCount: 2, baseDelayMs: 0 },
    fakeFetch as typeof fetch,
    async () => {},
  );

  assert.equal(result.attempts, 3);
  assert.equal(attempts, 3);
  assert.equal(result.rows.length, 4);
});

test("network failure is retried and a later valid response is accepted", async () => {
  let attempts = 0;
  const fakeFetch = async () => {
    attempts += 1;
    if (attempts === 1) throw new Error("socket reset");
    return new Response(participantCsv(), {
      status: 200,
      headers: { "content-type": "text/csv" },
    });
  };

  const result = await fetchNseParticipantDerivativesWithRetry(
    "OI",
    "2026-09-17",
    { retryCount: 2, baseDelayMs: 0 },
    fakeFetch as typeof fetch,
    async () => {},
  );

  assert.equal(result.attempts, 2);
  assert.equal(attempts, 2);
  assert.deepEqual(result.rows.map((row) => row.participant), ["CLIENT", "DII", "FII", "PRO"]);
});

test("malformed CSV fails closed without retrying invalid business data", async () => {
  let attempts = 0;
  const fakeFetch = async () => {
    attempts += 1;
    return new Response("wrong,header\nClient,1,2", {
      status: 200,
      headers: { "content-type": "text/csv" },
    });
  };

  await assert.rejects(
    () => fetchNseParticipantDerivativesWithRetry(
      "OI",
      "2026-09-17",
      { retryCount: 3, baseDelayMs: 0 },
      fakeFetch as typeof fetch,
      async () => {},
    ),
    /NSE_PARTICIPANT_CSV_HEADER_MISMATCH/,
  );
  assert.equal(attempts, 1);
});


test("transient 403 access block is retried before accepting a valid report", async () => {
  let attempts = 0;
  const fakeFetch = async () => {
    attempts += 1;
    if (attempts === 1) return new Response("blocked", { status: 403 });
    return new Response(participantCsv(), {
      status: 200,
      headers: { "content-type": "text/csv" },
    });
  };

  const result = await fetchNseParticipantDerivativesWithRetry(
    "OI",
    "2026-09-17",
    { retryCount: 2, baseDelayMs: 0 },
    fakeFetch as typeof fetch,
    async () => {},
  );

  assert.equal(result.attempts, 2);
  assert.equal(attempts, 2);
  assert.equal(result.rows.length, 4);
});

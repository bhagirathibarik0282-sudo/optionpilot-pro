import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { uploadEodArchiveToDrive, eodArchiveChecksum } from "../eod-drive-upload.js";

test("archive acceptance requires actual downloaded bytes, including reused files", async (t) => {
  const payload = JSON.stringify({ schemaVersion: "EOD_ARCHIVE_V2", tradingDate: "2026-10-08", researchMemories: [{ payload: { tradeDate: "2026-10-08" } }] });
  const names = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN", "GOOGLE_DRIVE_EOD_FOLDER_ID"];
  const previous = names.map(name => process.env[name]);
  names.forEach(name => { process.env[name] = "test-fixture"; });
  const originalFetch = globalThis.fetch;
  try {
    for (const scenario of ["valid", "corrupt", "unavailable", "size"] as const) {
      await t.test(scenario, async () => {
        let mediaRequests = 0;
        globalThis.fetch = async (input) => {
          const url = String(input);
          const file = { id: "fixture-file", name: "optionpilot-eod-2026-10-08.json", size: String(Buffer.byteLength(payload) + (scenario === "size" ? 1 : 0)), parents: ["test-fixture"], appProperties: { checksumSha256: eodArchiveChecksum(payload) }, md5Checksum: createHash("md5").update(payload).digest("hex") };
          if (url.includes("oauth2.googleapis.com")) return Response.json({ access_token: "fixture-access" });
          if (url.includes("?q=")) return Response.json({ files: [file] });
          if (url.includes("alt=media")) {
            mediaRequests++;
            return new Response(scenario === "corrupt" ? payload + "x" : payload, { status: scenario === "unavailable" ? 403 : 200 });
          }
          return Response.json(file);
        };
        if (scenario === "valid") assert.equal((await uploadEodArchiveToDrive("2026-10-08", payload)).reusedExisting, true);
        else await assert.rejects(uploadEodArchiveToDrive("2026-10-08", payload), new RegExp(scenario === "corrupt" ? "SHA256_MISMATCH" : scenario === "size" ? "SIZE_MISMATCH" : "READBACK_FAILED:403"));
        assert.equal(mediaRequests, 1);
      });
    }
  } finally {
    globalThis.fetch = originalFetch;
    names.forEach((name, i) => { if (previous[i] === undefined) delete process.env[name]; else process.env[name] = previous[i]; });
  }
});

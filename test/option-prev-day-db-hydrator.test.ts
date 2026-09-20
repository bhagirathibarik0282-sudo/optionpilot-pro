import test from "node:test";
import assert from "node:assert/strict";
import { mapPreviousDayDbRowsToTokens } from "../option-prev-day-db-hydrator.js";

test("maps exact strike/side rows onto current instrument tokens", () => {
  const got = mapPreviousDayDbRowsToTokens(
    [
      { instrumentToken: 101, strike: 23350, optionType: "CE" },
      { instrumentToken: 102, strike: 23350, optionType: "PE" },
    ],
    [
      { strike: 23350, option_type: "CE", pdh: 121.5, pdl: 68.25 },
      { strike: "23350", option_type: "PE", pdh: "110.4", pdl: "61.2" },
    ],
  );

  assert.deepEqual(got.get(101), { pdh: 121.5, pdl: 68.25 });
  assert.deepEqual(got.get(102), { pdh: 110.4, pdl: 61.2 });
});

test("fails closed on invalid levels or unmatched contracts", () => {
  const got = mapPreviousDayDbRowsToTokens(
    [{ instrumentToken: 201, strike: 56400, optionType: "CE" }],
    [
      { strike: 56400, option_type: "CE", pdh: 0, pdl: 50 },
      { strike: 56400, option_type: "CE", pdh: 40, pdl: 50 },
      { strike: 56500, option_type: "CE", pdh: 100, pdl: 50 },
      { strike: 56400, option_type: "XX", pdh: 100, pdl: 50 },
    ],
  );

  assert.equal(got.size, 0);
});

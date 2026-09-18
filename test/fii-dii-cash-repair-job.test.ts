import test from "node:test";
import assert from "node:assert/strict";
import {
  assertCashRepairReadback,
  cashRepairTradeDate,
  requireCashRepairWriteEnabled,
} from "../fii-dii-cash-repair-job.js";

test("cash repair requires explicit write guard", () => {
  assert.throws(
    () => requireCashRepairWriteEnabled({}),
    /FII_DII_CASH_REPAIR_WRITE_ENABLED_REQUIRED/,
  );
  assert.doesNotThrow(() => requireCashRepairWriteEnabled({
    FII_DII_CASH_REPAIR_WRITE_ENABLED: "1",
  }));
});

test("cash repair requires a real ISO trade date", () => {
  assert.equal(
    cashRepairTradeDate({ FII_DII_CASH_REPAIR_TRADE_DATE: "2026-09-17" }),
    "2026-09-17",
  );
  assert.throws(
    () => cashRepairTradeDate({ FII_DII_CASH_REPAIR_TRADE_DATE: "17-09-2026" }),
    /FII_DII_CASH_REPAIR_TRADE_DATE_REQUIRED_ISO/,
  );
  assert.throws(
    () => cashRepairTradeDate({ FII_DII_CASH_REPAIR_TRADE_DATE: "2026-02-31" }),
    /FII_DII_CASH_REPAIR_TRADE_DATE_INVALID/,
  );
});

test("cash repair exact DB readback accepts matching official values", () => {
  const expected = {
    date: "2026-09-17",
    source: "NSE_FII_DII",
    sourceUrl: "https://www.nseindia.com/api/fiidiiTradeNse",
    fii: { buy: 10, sell: 12, net: -2 },
    dii: { buy: 14, sell: 9, net: 5 },
  };
  const stored = {
    trade_date: "2026-09-17",
    source: "NSE_FII_DII",
    source_url: "https://www.nseindia.com/api/fiidiiTradeNse",
    fii_buy: 10,
    fii_sell: 12,
    fii_net: -2,
    dii_buy: 14,
    dii_sell: 9,
    dii_net: 5,
  };
  assert.doesNotThrow(() => assertCashRepairReadback(stored, expected));
});

test("cash repair exact DB readback rejects any mismatch", () => {
  const expected = {
    date: "2026-09-17",
    source: "NSE_FII_DII",
    sourceUrl: "https://www.nseindia.com/api/fiidiiTradeNse",
    fii: { buy: 10, sell: 12, net: -2 },
    dii: { buy: 14, sell: 9, net: 5 },
  };
  const stored = {
    trade_date: "2026-09-17",
    source: "NSE_FII_DII",
    source_url: "https://www.nseindia.com/api/fiidiiTradeNse",
    fii_buy: 10,
    fii_sell: 12,
    fii_net: -3,
    dii_buy: 14,
    dii_sell: 9,
    dii_net: 5,
  };
  assert.throws(
    () => assertCashRepairReadback(stored, expected),
    /FII_DII_CASH_REPAIR_DB_READBACK_MISMATCH/,
  );
});

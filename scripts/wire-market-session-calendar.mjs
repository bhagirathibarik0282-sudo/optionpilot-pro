import fs from "node:fs";
import path from "node:path";

const serverFile = path.resolve(process.cwd(), "server.ts");
const checkOnly = process.argv.includes("--check");
let server = fs.readFileSync(serverFile, "utf8");
const original = server;

function replaceOnce(source, from, to, label) {
  const count = source.split(from).length - 1;
  if (count === 0 && source.includes(to)) return source;
  if (count !== 1) throw new Error(`${label}: expected exactly 1 source occurrence, found ${count}`);
  return source.replace(from, to);
}

server = replaceOnce(
  server,
  'import { shouldRefreshCandidateSnapshot } from "./candidate-snapshot-freshness.js";',
  'import { shouldRefreshCandidateSnapshot } from "./candidate-snapshot-freshness.js";\nimport {\n  INDIAN_EQUITY_TRADING_HOLIDAYS_2026,\n  indianEquityMarketPhaseAt,\n  indianTradingDateAt,\n  isClosedCalendarPhase,\n  isIndianEquityMarketOpenAt,\n  type IndianEquityMarketPhase,\n} from "./market-session-calendar.js";',
  "market calendar import",
);

server = replaceOnce(
  server,
  "function computeTruthReport(m: IndexMetrics | undefined): TruthReport {",
  "function computeTruthReport(m: IndexMetrics | undefined, now = new Date()): TruthReport {",
  "truth report clock injection",
);

const truthAnchor = `  fields.optionsPE = atmPe
    ? classifyTruthField(atmPe.quoteTimestamp, TRUTH_THRESHOLDS_MS.options)
    : { verdict: "INVALID", ageMs: null, reason: "no_pe_leg" };`;
const truthBlock = `${truthAnchor}

  // A broker may return Friday's frozen index value on a weekday holiday
  // while m.timestamp records only this backend's fresh receipt time. That
  // receipt proves transport, not a live market. Never label any such field
  // TRUE during a calendar-closed session.
  const calendarPhase = indianEquityMarketPhaseAt(now);
  if (isClosedCalendarPhase(calendarPhase)) {
    for (const field of Object.values(fields)) {
      if (field.verdict !== "INVALID") {
        field.verdict = "STALE";
        field.reason = \`market_closed_\${calendarPhase.toLowerCase()}\`;
      }
    }
  }`;
server = replaceOnce(server, truthAnchor, truthBlock, "closed-market truth guard");

const oldClockBlock = `function isMarketOpenNowServer(): boolean {
  const now = new Date();
  const istString = now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" });
  const ist = new Date(istString);
  const day = ist.getDay();
  if (day === 0 || day === 6) return false;
  const minutesSinceMidnight = ist.getHours() * 60 + ist.getMinutes();
  return minutesSinceMidnight >= 9 * 60 + 15 && minutesSinceMidnight <= 15 * 60 + 30;
}

type V2MarketPhase = "WEEKEND" | "PREMARKET" | "OPENING_GRACE" | "LIVE_SESSION" | "POSTMARKET";

function v2MarketPhaseNow(): V2MarketPhase {
  const now = new Date();
  const istString = now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" });
  const ist = new Date(istString);
  const day = ist.getDay();
  if (day === 0 || day === 6) return "WEEKEND";
  const minutes = ist.getHours() * 60 + ist.getMinutes();
  if (minutes < 9 * 60 + 15) return "PREMARKET";
  // Give the 3-minute recorder/quote pipeline two cycles to initialize after 09:15.
  // This avoids false CRITICAL alerts during normal startup without weakening any
  // live-session freshness or candidate data-quality gate.
  if (minutes < 9 * 60 + 21) return "OPENING_GRACE";
  if (minutes <= 15 * 60 + 30) return "LIVE_SESSION";
  return "POSTMARKET";
}

function indiaTradingDate(): string {
  const now = new Date();
  const istString = now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" });
  const ist = new Date(istString);
  return ist.toISOString().slice(0, 10);
}`;
const newClockBlock = `function isMarketOpenNowServer(): boolean {
  return isIndianEquityMarketOpenAt(new Date());
}

type V2MarketPhase = IndianEquityMarketPhase;

function v2MarketPhaseNow(): V2MarketPhase {
  return indianEquityMarketPhaseAt(new Date());
}

function indiaTradingDate(): string {
  return indianTradingDateAt(new Date());
}`;
server = replaceOnce(server, oldClockBlock, newClockBlock, "market clock implementation");

server = replaceOnce(
  server,
  'app.get("/api/holidays", (c) => {\n  return c.json([]);\n});',
  'app.get("/api/holidays", (c) => {\n  return c.json(INDIAN_EQUITY_TRADING_HOLIDAYS_2026);\n});',
  "holiday endpoint",
);

if (checkOnly) {
  console.log(server === original ? "market session calendar wiring already applied" : "market session calendar wiring check passed");
  process.exit(0);
}

if (server !== original) fs.writeFileSync(serverFile, server, "utf8");
console.log(server !== original ? "market session calendar wiring applied" : "market session calendar wiring already applied");

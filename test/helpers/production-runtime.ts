import type { TestContext } from 'node:test';
import { appendFileSync } from 'node:fs';
import { operatingStatus } from '../../runtime-operating-window.js';

export const PRODUCTION_ORIGIN = 'https://optionpilot-pro-v2-production.up.railway.app';

// A closed runtime is pending evidence, never application readiness. A generic
// 503, a stale status, an active window or an enabled maintenance window fails.
export async function productionVerificationPending(
  response: Response,
  t: Pick<TestContext, 'skip' | 'diagnostic'>,
  fetchStatus: typeof fetch = fetch,
  clock = () => new Date(),
): Promise<boolean> {
  if (response.status !== 503 || new URL(response.url).origin !== PRODUCTION_ORIGIN) return false;
  let body: any;
  try { body = await response.clone().json(); } catch { return false; }
  const local = operatingStatus(clock());
  const closed = (value: any) => value && local.scheduled === false &&
    value.tradingDate === local.tradingDate && value.supervisor === true &&
    value.timezone === 'Asia/Kolkata' && value.hoursIST === '08:45–16:15' &&
    ['scheduled','maintenance','shouldRun','running','ready','draining'].every(key => value[key] === false);
  if (body?.error !== 'OUTSIDE_OPERATING_HOURS' || !closed(body)) return false;
  const status = await fetchStatus(PRODUCTION_ORIGIN + '/ops/runtime-status', {
    headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15_000),
  });
  if (!status.ok || !closed(await status.json()) || operatingStatus(clock()).scheduled || operatingStatus(clock()).tradingDate !== local.tradingDate) return false;
  const reason = 'PENDING_LIVE_VERIFICATION: confirmed scheduled runtime closure; real application readiness is unverified.';
  t.diagnostic(reason);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    '\n- **Production verification pending:** scheduled app closure confirmed. This skipped probe is not live readiness proof.\n');
  t.skip(reason);
  return true;
}

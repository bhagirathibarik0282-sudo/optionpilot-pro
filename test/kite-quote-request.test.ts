import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createKiteQuoteLimiter } from '../kite-quote-request.js';

function setup() {
  let now = 0;
  const request = createKiteQuoteLimiter({ now: () => now, wait: async ms => { now += ms; } });
  return { request, now: () => now };
}

test('spaces concurrent quote starts even while the previous response is pending', async () => {
  const { request, now } = setup();
  const starts: number[] = [];
  let finishFirst!: (response: Response) => void;
  const first = request(() => {
    starts.push(now());
    return new Promise(resolve => { finishFirst = resolve; });
  });
  await Promise.all([1, 2].map(() => request(async () => {
    starts.push(now());
    return new Response();
  })));
  finishFirst(new Response());
  await first;
  assert.deepEqual(starts, [0, 1100, 2200]);
});

test('honors broker cooldown without retrying the failed observation', async () => {
  const { request, now } = setup();
  const response = await request(async () => new Response(null, {
    status: 429,
    headers: { 'Retry-After': '4' },
  }));
  assert.equal(response.status, 429);
  await request(async () => {
    assert.equal(now(), 4000);
    return new Response();
  });
});

test('fails closed on obsolete and over-budget queued requests', async () => {
  const { request } = setup();
  await assert.rejects(request(async () => assert.fail('Obsolete request sent'), () => false), /REQUEST_EXPIRED/);
  await request(async () => new Response(null, { status: 429, headers: { 'Retry-After': '60' } }));
  await assert.rejects(request(async () => assert.fail('Request sent during cooldown')), /REQUEST_EXPIRED/);
});

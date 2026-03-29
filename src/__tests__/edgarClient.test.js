import { test, after } from 'node:test';
import assert from 'node:assert/strict';

// Save original fetch before any test modifies it
const originalFetch = globalThis.fetch;

after(() => {
  globalThis.fetch = originalFetch;
  delete process.env.SEC_USER_AGENT;
});

test('INFRA-01: edgarGet sets User-Agent header from SEC_USER_AGENT env var', async () => {
  process.env.SEC_USER_AGENT = 'TestApp test@example.com';

  let capturedHeaders;
  globalThis.fetch = async (url, init) => {
    capturedHeaders = init?.headers ?? {};
    return new Response(JSON.stringify({}), { status: 200 });
  };

  // Dynamic import after setting env var and mock fetch
  const { edgarGet } = await import('../ingestion/edgarClient.js?v=1');
  await edgarGet('https://data.sec.gov/test');

  assert.equal(capturedHeaders['User-Agent'], 'TestApp test@example.com');
});

test('INFRA-01: edgarGet uses fallback User-Agent when env var not set', async () => {
  delete process.env.SEC_USER_AGENT;

  let capturedHeaders;
  globalThis.fetch = async (url, init) => {
    capturedHeaders = init?.headers ?? {};
    return new Response(JSON.stringify({}), { status: 200 });
  };

  const { edgarGet } = await import('../ingestion/edgarClient.js?v=2');
  await edgarGet('https://data.sec.gov/test2');

  assert.ok(
    capturedHeaders['User-Agent'].startsWith('SpinoffScreener'),
    `Expected fallback User-Agent, got: ${capturedHeaders['User-Agent']}`
  );
});

test('INFRA-01: edgarGet retries on 429 and eventually succeeds', async () => {
  process.env.SEC_USER_AGENT = 'TestApp test@example.com';
  let callCount = 0;

  globalThis.fetch = async () => {
    callCount++;
    if (callCount === 1) return new Response('', { status: 429 });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };

  const { edgarGet } = await import('../ingestion/edgarClient.js?v=3');
  const res = await edgarGet('https://data.sec.gov/retry-test');
  assert.equal(res.status, 200);
  assert.equal(callCount, 2, 'Expected exactly 2 fetch calls (1 failure + 1 success)');
});

test('INFRA-01: edgarGet retries on 503 and eventually succeeds', async () => {
  process.env.SEC_USER_AGENT = 'TestApp test@example.com';
  let callCount = 0;

  globalThis.fetch = async () => {
    callCount++;
    if (callCount === 1) return new Response('', { status: 503 });
    return new Response('{}', { status: 200 });
  };

  const { edgarGet } = await import('../ingestion/edgarClient.js?v=4');
  const res = await edgarGet('https://efts.sec.gov/retry-503');
  assert.equal(res.status, 200);
});

test('INFRA-01: edgarGet throws on non-retryable 404', async () => {
  globalThis.fetch = async () => new Response('Not Found', { status: 404 });

  const { edgarGet } = await import('../ingestion/edgarClient.js?v=5');
  await assert.rejects(
    () => edgarGet('https://data.sec.gov/missing'),
    (err) => {
      assert.ok(err.message.includes('404'), `Expected 404 in error, got: ${err.message}`);
      return true;
    }
  );
});

test('INFRA-01: edgarGet throws after 4 consecutive 429 responses (max retries)', async () => {
  let callCount = 0;
  globalThis.fetch = async () => {
    callCount++;
    return new Response('', { status: 429 });
  };

  const { edgarGet } = await import('../ingestion/edgarClient.js?v=6');
  await assert.rejects(
    () => edgarGet('https://data.sec.gov/always-429'),
    /rate limited after/
  );
  assert.equal(callCount, 4);
});

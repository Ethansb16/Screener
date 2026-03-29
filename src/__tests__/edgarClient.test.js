import { test } from 'node:test';
import assert from 'node:assert/strict';

// TODO (Plan 02): Replace stubs with real tests once src/ingestion/edgarClient.js exists
// Tests to implement in Plan 02:
//   - Every edgarGet() call sets User-Agent header (INFRA-01)
//   - Concurrent calls are capped at ≤8 in-flight (INFRA-01)
//   - 429 response triggers exponential backoff + retry (INFRA-01)

test('INFRA-01: stub — edgarClient tests pending Plan 02', () => {
  // Placeholder so test suite passes before Plan 02 is executed
  assert.ok(true, 'edgarClient stubs will be replaced in Plan 02');
});

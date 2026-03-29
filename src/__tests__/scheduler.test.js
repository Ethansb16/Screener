import { test } from 'node:test';
import assert from 'node:assert/strict';
import cron from 'node-cron';

test('INFRA-03: cron.validate accepts the default daily schedule "0 7 * * *"', () => {
  assert.equal(cron.validate('0 7 * * *'), true);
});

test('INFRA-03: cron.validate accepts any valid 5-part cron expression', () => {
  assert.equal(cron.validate('*/5 * * * *'), true, 'every-5-min schedule should be valid');
  assert.equal(cron.validate('0 6 * * 1-5'), true, 'weekday-only schedule should be valid');
});

test('INFRA-03: cron.validate rejects invalid expressions', () => {
  assert.equal(cron.validate('not-a-cron'), false, 'invalid string should be rejected');
  assert.equal(cron.validate('99 99 * * *'), false, 'out-of-range values should be rejected');
});

test('INFRA-03: startScheduler is exported as a function', async () => {
  const { startScheduler } = await import('../scheduler.js');
  assert.equal(typeof startScheduler, 'function');
});

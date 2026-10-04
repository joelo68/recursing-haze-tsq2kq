import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getDailyAuditPolicy,
  getDefaultDailyAuditDate,
  getMillisecondsUntilNextTaipeiActionBoundary,
  getMillisecondsUntilNextTaipeiCutoff,
} from '../src/utils/dailyAuditPolicy.js';

test('daily audit policy keeps the existing 18:00 Asia/Taipei cutoff', () => {
  const before = new Date('2026-10-04T09:59:00Z'); // 17:59 Asia/Taipei
  const after = new Date('2026-10-04T10:01:00Z'); // 18:01 Asia/Taipei

  assert.equal(getDefaultDailyAuditDate(before), '2026-10-03');
  assert.equal(getDefaultDailyAuditDate(after), '2026-10-04');
  assert.equal(getDailyAuditPolicy(before).cutoffReached, false);
  assert.equal(getDailyAuditPolicy(after).cutoffReached, true);
});

test('action boundary timer is one-shot to the next cutoff or Taipei midnight', () => {
  const beforeCutoff = new Date('2026-10-04T09:00:00Z'); // 17:00
  assert.equal(getMillisecondsUntilNextTaipeiCutoff(beforeCutoff), 60 * 60 * 1000);
  assert.equal(getMillisecondsUntilNextTaipeiActionBoundary(beforeCutoff), 60 * 60 * 1000);

  const afterCutoff = new Date('2026-10-04T11:00:00Z'); // 19:00
  assert.equal(getMillisecondsUntilNextTaipeiActionBoundary(afterCutoff), 5 * 60 * 60 * 1000);
});

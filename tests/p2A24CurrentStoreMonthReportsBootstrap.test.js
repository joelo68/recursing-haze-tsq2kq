import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBootstrapBucketPlan,
  mergeBootstrapBucketData,
} from '../functions/currentStoreMonthReportsBootstrap.js';

const sourceEventKey = (value) => Buffer.from(String(value || ''), 'utf8').toString('base64url');

const raw = (id, date, storeName, updateTime, extra = {}) => ({
  id,
  data: { date, storeName, ...extra },
  updateTime,
});

test('B2C plan rejects duplicate Raw canonical Store×Date before writes', () => {
  const result = buildBootstrapBucketPlan({
    brandId: 'cyj',
    yearMonth: '2026-09',
    snapshotCutoff: '2026-09-28T07:00:00.000Z',
    rawRows: [
      raw('a', '2026-09-01', 'CYJ台北店', '2026-09-01T10:00:00.000Z'),
      raw('b', '2026-09-01', 'CYJ台北店', '2026-09-01T11:00:00.000Z'),
    ],
    projectionDocs: [],
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'RAW_DUPLICATE_STORE_DATE');
});

test('B2C merge preserves live event newer than snapshot cutoff', () => {
  const plan = buildBootstrapBucketPlan({
    brandId: 'cyj',
    yearMonth: '2026-09',
    snapshotCutoff: '2026-09-28T07:00:00.000Z',
    rawRows: [raw('a', '2026-09-01', 'CYJ台北店', '2026-09-01T10:00:00.000Z', { cash: 100 })],
    projectionDocs: [],
  });
  assert.equal(plan.ok, true);
  const bucket = plan.buckets[0].bucket;
  const merged = mergeBootstrapBucketData({
    currentData: {
      sourceEvents: {
        [sourceEventKey('newer-live')]: {
          sourceReportId: 'newer-live',
          eventTimestamp: '2026-09-28T07:00:05.000Z',
          exists: true,
          row: { sourceReportId: 'newer-live', date: '2026-09-28', storeName: 'CYJ台北店', cash: 9 },
        },
      },
    },
    bucket,
    rawEntries: plan.buckets[0].rawEntries,
    rawBySourceId: plan.rawBySourceId,
    snapshotCutoff: plan.snapshotCutoff,
  });
  assert.equal(merged.data.sourceEvents[sourceEventKey('newer-live')].exists, true);
  assert.equal(merged.preservedNewerEvents, 1);
});

test('B2C merge tombstones stale projection-only source older than snapshot cutoff', () => {
  const plan = buildBootstrapBucketPlan({
    brandId: 'cyj',
    yearMonth: '2026-09',
    snapshotCutoff: '2026-09-28T07:00:00.000Z',
    rawRows: [raw('a', '2026-09-01', 'CYJ台北店', '2026-09-01T10:00:00.000Z')],
    projectionDocs: [],
  });
  const bucket = plan.buckets[0].bucket;
  const merged = mergeBootstrapBucketData({
    currentData: {
      sourceEvents: {
        [sourceEventKey('stale-source')]: {
          sourceReportId: 'stale-source',
          eventTimestamp: '2026-09-20T10:00:00.000Z',
          exists: true,
          row: { sourceReportId: 'stale-source', date: '2026-09-02', storeName: 'CYJ台北店' },
        },
      },
    },
    bucket,
    rawEntries: plan.buckets[0].rawEntries,
    rawBySourceId: plan.rawBySourceId,
    snapshotCutoff: plan.snapshotCutoff,
  });
  assert.equal(merged.data.sourceEvents[sourceEventKey('stale-source')].exists, false);
  assert.equal(merged.appliedTombstones, 1);
});

test('B2C plan rejects explicit cross-brand Raw store identity', () => {
  const result = buildBootstrapBucketPlan({
    brandId: 'anniu',
    yearMonth: '2026-09',
    snapshotCutoff: '2026-09-28T07:00:00.000Z',
    rawRows: [raw('x', '2026-09-01', 'CYJ台北店', '2026-09-01T10:00:00.000Z')],
    projectionDocs: [],
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'RAW_INVALID');
});

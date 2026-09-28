import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CURRENT_STORE_MONTH_REPORTS_READINESS_VERSION,
  assessCurrentStoreMonthReadiness,
  normalizeExpectedRevision,
} from '../functions/currentStoreMonthReportsReadiness.js';

const sig = (char) => char.repeat(64);

function makeAudit({
  current = sig('b'),
  certified = sig('a'),
  parity = true,
  consumerReady = false,
  readinessVersion = '',
  readinessStatus = '',
} = {}) {
  return {
    brandId: 'cyj',
    yearMonth: '2026-09',
    comparison: {
      parity,
      sourceSignature: current,
      projectionSignature: current,
      sourceOnly: { total: 0, sample: [] },
      projectionOnly: { total: 0, sample: [] },
      rawInvalidCount: 0,
      rawDuplicateStoreDateCount: 0,
      projectionInvalidCount: 0,
      projectionDuplicateStoreDateCount: 0,
    },
    status: {
      exists: true,
      status: 'BOOTSTRAP_CERTIFIED',
      revision: 1,
      schemaVersion: 'current-store-month-reports-v1',
      certifiedSourceSignature: certified,
      certifiedProjectionSignature: certified,
      consumerReady,
      readinessVersion,
      readinessStatus,
      consumerReadySourceSignature: consumerReady ? current : '',
      consumerReadyProjectionSignature: consumerReady ? current : '',
    },
  };
}

test('B3-2 waits when exact parity has not advanced beyond the bootstrap baseline', () => {
  const audit = makeAudit({ current: sig('a'), certified: sig('a') });
  const result = assessCurrentStoreMonthReadiness({ audit });
  assert.equal(result.code, 'WAITING_FOR_LIVE_EVENT');
  assert.equal(result.consumerReady, false);
  assert.equal(result.promotable, false);
});

test('B3-2 becomes promotable only after post-bootstrap exact parity advances', () => {
  const result = assessCurrentStoreMonthReadiness({ audit: makeAudit() });
  assert.equal(result.code, 'READY_TO_PROMOTE');
  assert.equal(result.consumerReady, false);
  assert.equal(result.promotable, true);
  assert.notEqual(result.currentSourceSignature, result.certifiedSourceSignature);
});

test('B3-2 fails closed on parity or data-quality failure', () => {
  const audit = makeAudit({ parity: false });
  audit.comparison.projectionSignature = sig('c');
  audit.comparison.sourceOnly.total = 1;
  const result = assessCurrentStoreMonthReadiness({ audit });
  assert.equal(result.code, 'CURRENT_PARITY_FAILED');
  assert.equal(result.promotable, false);
});

test('B3-2 recognizes already-persisted readiness only for its own versioned contract', () => {
  const result = assessCurrentStoreMonthReadiness({
    audit: makeAudit({
      consumerReady: true,
      readinessVersion: CURRENT_STORE_MONTH_REPORTS_READINESS_VERSION,
      readinessStatus: 'CONSUMER_READY',
    }),
  });
  assert.equal(result.code, 'ALREADY_CONSUMER_READY');
  assert.equal(result.consumerReady, true);
  assert.equal(result.promotable, false);
});

test('B3-2 expected revision is strict non-negative integer', () => {
  assert.equal(normalizeExpectedRevision(0), 0);
  assert.equal(normalizeExpectedRevision('2'), 2);
  assert.throws(() => normalizeExpectedRevision(-1), /INVALID_EXPECTED_REVISION/);
  assert.throws(() => normalizeExpectedRevision('1.5'), /INVALID_EXPECTED_REVISION/);
  assert.throws(() => normalizeExpectedRevision('x'), /INVALID_EXPECTED_REVISION/);
});

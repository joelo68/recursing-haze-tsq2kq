import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CURRENT_STORE_MONTH_REPORTS_READINESS_VERSION,
  assessCurrentStoreMonthReadiness,
  normalizeExpectedRevision,
  createCurrentStoreMonthReportsReadinessFunctions,
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


function createHttpRecorder() {
  let statusCode = 200;
  let body;
  return {
    res: {
      status(code) { statusCode = code; return this; },
      json(value) { body = value; return value; },
    },
    get statusCode() { return statusCode; },
    get body() { return body; },
  };
}

function createReadinessHandler({
  requestAuth = { ok: true, decoded: { firebase: { sign_in_provider: 'anonymous' } } },
  actorCheck = { ok: true, actorName: 'Joe 總經理', actorRole: 'director', actorAccountId: 'Joe 總經理' },
  audit = makeAudit(),
  onAssert = () => {},
  onVerify = () => {},
  onAudit = () => {},
} = {}) {
  let handler;
  const onRequest = (_options, fn) => { handler = fn; return fn; };
  createCurrentStoreMonthReportsReadinessFunctions({
    onRequest,
    admin: { firestore: { FieldValue: { serverTimestamp: () => ({}) } } },
    db: {},
    getBrandCollection: () => ({ doc: () => ({}) }),
    requireFirebaseRequestAuth: async () => requestAuth,
    verifySuperAdminActor: async () => { onVerify(); return actorCheck; },
    assertAdminApplicationClaims: (...args) => onAssert(...args),
    auditBrandProjection: async () => { onAudit(); return audit; },
  });
  return handler;
}

const TEST_ACTOR = Object.freeze({
  roleId: 'director',
  accountId: 'Joe 總經理',
  deviceId: 'dev_test',
  credentialPassword: 'not-a-real-password',
});

test('B3-2 plan preserves the existing read-only operator contract without application-identity binding', async () => {
  let assertCalls = 0;
  let verifyCalls = 0;
  let auditCalls = 0;
  const handler = createReadinessHandler({
    audit: makeAudit({ current: sig('a'), certified: sig('a') }),
    onAssert: () => { assertCalls += 1; throw new Error('plan must not call application identity gate'); },
    onVerify: () => { verifyCalls += 1; },
    onAudit: () => { auditCalls += 1; },
  });
  const http = createHttpRecorder();
  await handler({ method: 'POST', body: { brandId: 'cyj', action: 'plan', actor: TEST_ACTOR } }, http.res);
  assert.equal(http.statusCode, 200);
  assert.equal(http.body?.writeMode, false);
  assert.equal(http.body?.firestoreWrites, 0);
  assert.equal(assertCalls, 0);
  assert.equal(verifyCalls, 1);
  assert.equal(auditCalls, 1);
});

test('B3-2 apply fails before credential/audit work when application identity does not match actor', async () => {
  let assertCalls = 0;
  let verifyCalls = 0;
  let auditCalls = 0;
  const identityError = new Error('admin_application_identity_mismatch');
  identityError.code = 'admin_application_identity_mismatch';
  identityError.status = 403;
  const handler = createReadinessHandler({
    onAssert: () => { assertCalls += 1; throw identityError; },
    onVerify: () => { verifyCalls += 1; },
    onAudit: () => { auditCalls += 1; },
  });
  const http = createHttpRecorder();
  await handler({ method: 'POST', body: { brandId: 'cyj', action: 'apply', actor: TEST_ACTOR } }, http.res);
  assert.equal(http.statusCode, 403);
  assert.equal(http.body?.code, 'admin_application_identity_mismatch');
  assert.equal(assertCalls, 1);
  assert.equal(verifyCalls, 0);
  assert.equal(auditCalls, 0);
});

test('B3-2 apply re-binds application identity after server-side super-admin verification', async () => {
  let assertCalls = 0;
  let verifyCalls = 0;
  let auditCalls = 0;
  const handler = createReadinessHandler({
    onAssert: (_requestAuth, _brandId, _actor, adminCheck) => {
      assertCalls += 1;
      if (assertCalls === 1) assert.equal(adminCheck?.actorAccountId, TEST_ACTOR.accountId);
      if (assertCalls === 2) assert.equal(adminCheck?.actorAccountId, TEST_ACTOR.accountId);
    },
    onVerify: () => { verifyCalls += 1; },
    onAudit: () => { auditCalls += 1; },
  });
  const http = createHttpRecorder();
  await handler({ method: 'POST', body: { brandId: 'cyj', action: 'apply', actor: TEST_ACTOR } }, http.res);
  assert.equal(http.statusCode, 400);
  assert.equal(http.body?.code, 'READINESS_CONFIRMATION_REQUIRED');
  assert.equal(assertCalls, 2);
  assert.equal(verifyCalls, 1);
  assert.equal(auditCalls, 1);
});


test('B3-2 apply fails closed when post-verification actor binding changes', async () => {
  let assertCalls = 0;
  let auditCalls = 0;
  const postError = new Error('admin_application_identity_mismatch');
  postError.code = 'admin_application_identity_mismatch';
  postError.status = 403;
  const handler = createReadinessHandler({
    onAssert: () => {
      assertCalls += 1;
      if (assertCalls === 2) throw postError;
    },
    onAudit: () => { auditCalls += 1; },
  });
  const http = createHttpRecorder();
  await handler({ method: 'POST', body: { brandId: 'cyj', action: 'apply', actor: TEST_ACTOR } }, http.res);
  assert.equal(http.statusCode, 403);
  assert.equal(http.body?.code, 'admin_application_identity_mismatch');
  assert.equal(assertCalls, 2);
  assert.equal(auditCalls, 0);
});

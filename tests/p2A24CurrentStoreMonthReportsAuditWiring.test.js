import test from "node:test";
import assert from "node:assert/strict";
import { CURRENT_APP_VERSION_SOURCE_PATTERN } from "./helpers/appVersionContract.js";
import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");

test("B2A audit endpoint is current-month, read-only, highest-admin protected", () => {
  const source = read("functions/currentStoreMonthReportsAudit.js");
  assert.match(source, /requireFirebaseRequestAuth/);
  assert.match(source, /verifySuperAdminActor/);
  assert.match(source, /requestedYearMonth !== currentYearMonth/);
  assert.match(source, /auditOnly: true/);
  assert.match(source, /firestoreWrites: 0/);
  // Map#set is used by the in-memory parity inventory and is not a Firestore write.
  // Fail only on actual member write methods other than the three approved Map#set owners.
  const memberWriteCalls = [...source.matchAll(/([A-Za-z_$][\w$]*)\.(set|update|delete|create)\s*\(/g)]
    .map((match) => ({ owner: match[1], method: match[2] }));
  const approvedMapSetOwners = new Set(["storeDateSources", "activeStoreDates", "rightCounts"]);
  const unexpectedWriteCalls = memberWriteCalls.filter(({ owner, method }) => (
    method !== "set" || !approvedMapSetOwners.has(owner)
  ));
  assert.deepEqual(unexpectedWriteCalls, []);
  assert.doesNotMatch(source, /\brunTransaction\b/);
  assert.doesNotMatch(source, /\bbatch\s*\(/);
  assert.doesNotMatch(source, /\badmin\.firestore\.FieldValue\b/);
});

test("B2A read topology is one bounded current-month Raw query plus compact projection/status reads", () => {
  const source = read("functions/currentStoreMonthReportsAudit.js");
  assert.match(source, /\.where\('date', '>='/);
  assert.match(source, /\.where\('date', '<='/);
  assert.match(source, /\.where\('yearMonth', '=='/);
  assert.match(source, /CURRENT_STORE_MONTH_REPORTS_STATUS_COLLECTION/);
  assert.doesNotMatch(source, /setInterval\s*\(/);
  assert.doesNotMatch(source, /onSnapshot/);
  assert.doesNotMatch(source, /onSchedule/);
});

test("B2A hardens the live writer against explicit cross-brand store names", () => {
  const current = read("functions/currentStoreMonthReports.js");
  const index = read("functions/index.js");
  assert.match(current, /explicitStoreBrand && explicitStoreBrand !== normalizedBrandId/);
  assert.match(index, /detectStoreBrandFromName,/);
});

test("B2A audit contract remains isolated after the later B4 frontend cutover and uses the shared app-version contract", () => {
  const app = read("src/App.jsx");
  // B4 intentionally introduces the frontend Projection consumer; B2A only owns audit isolation.
  assert.match(app, CURRENT_APP_VERSION_SOURCE_PATTERN);
});

test("B2A local client is audit-only and has no bootstrap apply path", () => {
  const client = read("scripts/currentStoreMonthReportsAuditClient.mjs");
  assert.match(client, /FIRESTORE_WRITES=0/);
  assert.match(client, /BOOTSTRAP_PERFORMED=NO/);
  assert.doesNotMatch(client, /--apply/);
  assert.doesNotMatch(client, /bootstrapCurrentStoreMonth/);
});

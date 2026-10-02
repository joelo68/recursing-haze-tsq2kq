import { CURRENT_APP_VERSION_DOC_PATTERN, CURRENT_APP_VERSION_SOURCE_PATTERN } from "./helpers/appVersionContract.js";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  DAILY_REPORT_DATE_SAFETY,
  classifyDailyReportDate,
  formatReportMonthDay,
  getCurrentTaipeiReportDate,
} from "../src/utils/dailyReportDateSafety.js";

const inputView = fs.readFileSync(new URL("../src/components/InputView.jsx", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const guide = fs.readFileSync(new URL("../docs/DEVELOPMENT_GUIDE.md", import.meta.url), "utf8");
const docsReadme = fs.readFileSync(new URL("../docs/README.md", import.meta.url), "utf8");

test("date safety uses Asia/Taipei with the existing 04:00 business-day rollover", () => {
  assert.equal(DAILY_REPORT_DATE_SAFETY.timeZone, "Asia/Taipei");
  assert.equal(DAILY_REPORT_DATE_SAFETY.reportDayRolloverHour, 4);
  assert.equal(DAILY_REPORT_DATE_SAFETY.sameDaySubmitStartHour, 15);

  const now = new Date("2026-10-01T18:00:00.000Z"); // 10/02 02:00 Taipei
  assert.equal(getCurrentTaipeiReportDate(now), "2026-10-01");
  const decision = classifyDailyReportDate("2026-10-01", now);
  assert.equal(decision.allowed, true);
  assert.equal(decision.status, "CURRENT_REPORT_DATE");
});

test("same-day report is hard-blocked before 15:00 Taipei and allowed exactly at 15:00", () => {
  const before = classifyDailyReportDate("2026-10-02", new Date("2026-10-02T06:59:59.000Z"));
  assert.equal(before.allowed, false);
  assert.equal(before.status, "SAME_DAY_BEFORE_CUTOFF");
  assert.equal(before.taipeiTimeText, "14:59");

  const atCutoff = classifyDailyReportDate("2026-10-02", new Date("2026-10-02T07:00:00.000Z"));
  assert.equal(atCutoff.allowed, true);
  assert.equal(atCutoff.status, "CURRENT_REPORT_DATE");
});

test("future date is blocked and historical date is explicit backfill", () => {
  const now = new Date("2026-10-02T08:00:00.000Z"); // 16:00 Taipei

  const future = classifyDailyReportDate("2026-10-03", now);
  assert.equal(future.allowed, false);
  assert.equal(future.status, "FUTURE_DATE");

  const history = classifyDailyReportDate("2026-10-01", now);
  assert.equal(history.allowed, true);
  assert.equal(history.status, "BACKFILL");
  assert.equal(history.isBackfill, true);
  assert.equal(formatReportMonthDay("2026-10-01"), "10/1");
});

test("invalid calendar dates fail closed", () => {
  const decision = classifyDailyReportDate("2026-02-31", new Date("2026-10-02T08:00:00.000Z"));
  assert.equal(decision.allowed, false);
  assert.equal(decision.status, "INVALID_DATE");
});

test("InputView applies the shared date-safety contract to Store and Therapist pre-submit and final-submit", () => {
  assert.match(inputView, /import \{ classifyDailyReportDate, formatReportMonthDay, getCurrentTaipeiReportDate \}/);
  assert.equal((inputView.match(/const safetyDecision = classifyDailyReportDate\(inputDate\);/g) || []).length, 4);
  assert.equal((inputView.match(/setDateSafetyBlock\(buildDateSafetyBlock\(safetyDecision\)\)/g) || []).length, 4);
  assert.equal((inputView.match(/safetyDecision\.status === "BACKFILL"/g) || []).length, 2);
  assert.equal((inputView.match(/<DateSafetyBlockModal block=\{dateSafetyBlock\}/g) || []).length, 2);
  assert.equal((inputView.match(/確認補登 \$\{formatReportMonthDay\(inputDate\)\} 日報/g) || []).length, 2);
  assert.match(inputView, /下午 3:00 前不可送出/);
  assert.match(inputView, /返回重新確認/);
});

test("date safety adds no Firestore primitive and preserves existing raw-path and permission authority", () => {
  const utility = fs.readFileSync(new URL("../src/utils/dailyReportDateSafety.js", import.meta.url), "utf8");
  assert.doesNotMatch(
    utility,
    /onSnapshot|getDoc|getDocs|setDoc|addDoc|updateDoc|deleteDoc|collection\s*\(|query\s*\(|setInterval\s*\(/
  );
  assert.match(inputView, /getCollectionPath\("daily_reports"\)/);
  assert.match(inputView, /getCollectionPath\("therapist_daily_reports"\)/);
  assert.match(inputView, /canEditStoreReport\(selectedStore, "editReports"\)/);
  assert.match(inputView, /Summary dirty 與重算 Queue 由後端 onWrite/);
});

test("this batch promotes CURRENT_APP_VERSION through the shared version contract and documents the guardrail", () => {
  assert.match(app, CURRENT_APP_VERSION_SOURCE_PATTERN);
  assert.match(guide, /# Daily Report Date Safety v1/);
  assert.match(guide, /same-day submit start\s*= 15:00/);
  assert.match(docsReadme, CURRENT_APP_VERSION_DOC_PATTERN);
});

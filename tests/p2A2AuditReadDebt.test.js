import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const app = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const audit = fs.readFileSync(new URL("../src/components/AuditView.jsx", import.meta.url), "utf8");

test("P2-A2.2B Audit store-daily owns only store Raw report authority", () => {
  assert.equal(app.includes('const auditNeedsDailyReports = activeView !== "audit" || auditType === "daily";'), true);
  assert.equal(app.includes('const auditNeedsTherapistReports = activeView !== "audit" || auditType === "therapist-daily";'), true);
  assert.equal(app.includes('MONTHLY_DAILY_REPORT_DATA_VIEWS.has(activeView) &&\n      auditNeedsDailyReports'), true);
});

test("P2-A2.2B therapist-daily gates the therapist monthly report source", () => {
  assert.equal(
    app.includes('MONTHLY_THERAPIST_REPORT_DATA_VIEWS.has(activeView) &&\n        auditNeedsTherapistReports'),
    true
  );
  assert.equal(app.includes('trackSnapshotRead("therapist_daily_reports_current_month"'), true);
});

test("P2-A2.2B target audit keeps target authorities instead of Raw report listeners", () => {
  assert.equal(app.includes('(activeView === "audit" && auditType === "target")'), true);
  assert.equal(app.includes('(activeView === "audit" && auditType === "therapist-target")'), true);
  assert.equal(app.includes('(activeView === "audit" && auditType === "therapist-daily")'), true);
});

test("P2-A2.2B report listener reacts immediately to Audit subtype switching", () => {
  const dependencyLine = app.split("\n").find(
    (line) =>
      line.includes("historicalDetailRefreshToken") &&
      line.includes("activeView") &&
      line.includes("dashboardViewMode")
  );
  assert.ok(dependencyLine, "monthly report listener dependency array missing");
  assert.equal(dependencyLine.includes("auditType"), true);
});

test("P2-A2.2B Audit consumers keep Raw reports isolated to daily subtypes", () => {
  assert.equal(audit.includes("if (auditType === 'daily')"), true);
  assert.equal(audit.includes("} else if (auditType === 'therapist-daily')"), true);
  assert.equal(audit.includes("else if (auditType === 'target')"), true);
  assert.equal(audit.includes("else if (auditType === 'therapist-target')"), true);
  assert.equal(audit.includes("const rawNorm = rawData.map"), true);
  assert.equal(audit.includes("const thNorm = (therapistReports || []).map"), true);
});

test("P2-A2.2B does not add a second report listener or polling path", () => {
  const dailySnapshotTrackCount = (app.match(/trackSnapshotRead\("daily_reports_current_month"/g) || []).length;
  const therapistSnapshotTrackCount = (app.match(/trackSnapshotRead\("therapist_daily_reports_current_month"/g) || []).length;
  assert.equal(dailySnapshotTrackCount, 1);
  assert.equal(therapistSnapshotTrackCount, 1);
  assert.equal(audit.includes("setInterval("), false);
});

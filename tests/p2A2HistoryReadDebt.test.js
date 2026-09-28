import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const app = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const history = fs.readFileSync(new URL("../src/components/HistoryView.jsx", import.meta.url), "utf8");

const getSetLine = (name) => {
  const line = app.split("\n").find((row) => row.includes(`const ${name} = new Set([`));
  assert.ok(line, `${name} missing`);
  return line;
};

test("P2-A2.2A History no longer activates App whole-month store report reads", () => {
  const line = getSetLine("MONTHLY_DAILY_REPORT_DATA_VIEWS");
  assert.equal(line.includes('"history"'), false);
  for (const required of ['"dashboard"', '"regional"', '"ranking"', '"store-analysis"', '"audit"']) {
    assert.equal(line.includes(required), true, `${required} must remain`);
  }
});

test("P2-A2.2A History no longer activates App whole-month therapist report reads", () => {
  const line = getSetLine("MONTHLY_THERAPIST_REPORT_DATA_VIEWS");
  assert.equal(line.includes('"history"'), false);
  assert.equal(line.includes('"audit"'), true);
});

test("P2-A2.2A History owns scoped user-triggered date-range reads", () => {
  assert.equal(history.includes("const [hasQueried, setHasQueried] = useState(false);"), true);
  assert.equal(history.includes("if (!hasQueried)"), true);
  assert.equal(history.includes('where("date", ">=", queryRange.start)'), true);
  assert.equal(history.includes('where("date", "<=", queryRange.end)'), true);
  assert.equal(history.includes("const snap = await getDocs(q);"), true);
  assert.equal(history.includes("onSnapshot"), false);
});

test("P2-A2.2A History does not consume App raw report arrays", () => {
  assert.equal(history.includes("allReports"), false);
  assert.equal(history.includes("rawData"), false);
  assert.equal(history.includes("therapistReports"), false);
});

test("P2-A2.2A current-month live listener remains available to real-time consumers", () => {
  assert.equal(app.includes('trackSnapshotRead("daily_reports_current_month"'), true);
  assert.equal(
    app.includes('query(getCollectionPath("daily_reports"), where("date", ">=", startDate), where("date", "<=", endDate), orderBy("date", "desc"))'),
    true
  );
});

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  KPI_PRESENTATION_LABELS,
  resolveKpiPresentationLabel,
} from "../src/utils/kpiPresentation.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

test("presentation labels distinguish KPI states", () => {
  assert.equal(KPI_PRESENTATION_LABELS.TARGET_NOT_SET, "目標未設定");
  assert.equal(KPI_PRESENTATION_LABELS.TARGET_INCOMPLETE, "目標資料不足");
  assert.equal(KPI_PRESENTATION_LABELS.DATA_INCOMPLETE, "資料不足");
  assert.equal(KPI_PRESENTATION_LABELS.FIELD_MISSING, "尚無資料");
  assert.equal(KPI_PRESENTATION_LABELS.DATA_INVALID, "資料異常");
  assert.equal(KPI_PRESENTATION_LABELS.N_A, "不適用");
  assert.equal(KPI_PRESENTATION_LABELS.NOT_STARTED, "尚未開始");
  assert.equal(KPI_PRESENTATION_LABELS.PRE_SYSTEM, "不納入");
  assert.equal(KPI_PRESENTATION_LABELS.LIFECYCLE_NOT_READY, "營運期間未完成");
});

test("VALID_ZERO is never relabeled as target missing", () => {
  assert.notEqual(resolveKpiPresentationLabel({ status: "VALID_ZERO" }), "目標未設定");
  assert.equal(resolveKpiPresentationLabel({ status: "TARGET_NOT_SET" }), "目標未設定");
});

test("primary KPI pages no longer expose bare N/A literals", () => {
  for (const rel of [
    "src/components/AnnualView.jsx",
    "src/components/DailyView.jsx",
    "src/components/RankingView.jsx",
    "src/components/RegionalView.jsx",
    "src/components/SmartForecastAccuracyPanel.jsx",
    "src/components/StoreAnalysisView.jsx",
    "src/components/StorePerformanceView.jsx",
  ]) {
    assert.equal(read(rel).includes('"N/A"'), false, `${rel} still exposes bare N/A`);
  }
});

test("projection observability labels use management language", () => {
  const source = read("src/utils/projectionObservability.js");
  for (const phrase of [
    "Projection Model 不存在",
    "Projection Model 版本不相容",
    "V2 Phase 尚未就緒",
    "V2 部分指標 Phase 不可靠",
    "V2 模型狀態正常",
    "V1 品牌出現非預期 V2 metadata",
    "V1 模型狀態正常",
  ]) {
    assert.equal(source.includes(phrase), false, `stale engineering label: ${phrase}`);
  }
});

test("Settings V3 missing-comma regression is fixed", () => {
  const source = read("src/components/SettingsView.jsx");
  assert.match(source, /label: "營運指標設定", isAdminOnly: true, icon: Target \},\s*\{ id: "health"/);
});

test("TherapistPerformance wording exception is preserved", () => {
  const source = read("src/components/TherapistPerformanceView.jsx");
  assert.match(source, /Top 5/);
  assert.match(source, /\bME\b/);
  assert.match(source, /\bvs\b/);
});

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  PROJECTION_ACCURACY_HISTORICAL_EVIDENCE,
} from "../src/data/projectionAccuracyHistoricalEvidence.js";

import {
  PROJECTION_ACCURACY_METHOD_LABELS,
  PROJECTION_HISTORICAL_METHOD_LABELS,
  buildProjectionObservabilitySnapshot,
  buildProjectionAccuracyObservabilitySnapshot,
  buildProjectionHistoricalAccuracyComparison,
  getProjectionHistoryYearsForRange,
  describeProjectionBias,
  getProjectionAccuracyDisplayPct,
  getProjectionObservabilityTone,
  getTaipeiProjectionYearMonth,
} from "../src/utils/projectionObservability.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const SOURCE_MONTHS = ["2026-06", "2026-07", "2026-08"];

const makeV2Model = (brandId = "cyj") => ({
  schemaVersion: "projection-model-v1",
  semanticVersion: "projection-semantic-v1",
  strategyVersion: "projection-strategy-v2-phase-calibrated",
  brandId,
  modelMonth: "2026-09",
  sourceMonths: SOURCE_MONTHS,
  generatedAtText: "2026-09-08T08:24:45.578Z",
  trigger: "manual_secure_rebuild",
  excludedStoreKeys: brandId === "cyj" ? ["中美"] : [],
  stores: { A: {}, B: {} },
  brand: {
    phaseCalibration: {
      schemaVersion: "projection-phase-v1",
      brandId,
      enabled: true,
      strategyVersion: "projection-strategy-v2-phase-calibrated",
      sourceMonths: SOURCE_MONTHS,
      cash: { reliable: true, sourceMonthCount: 3, completeSourceMonths: SOURCE_MONTHS },
      accrual: { reliable: true, sourceMonthCount: 3, completeSourceMonths: SOURCE_MONTHS },
    },
  },
});

test("Taipei year-month does not depend on UTC month boundary", () => {
  assert.equal(
    getTaipeiProjectionYearMonth(new Date("2026-08-31T16:30:00.000Z")),
    "2026-09"
  );
});

test("CYJ V2 model is healthy when both phase metrics are reliable", () => {
  const result = buildProjectionObservabilitySnapshot({
    model: makeV2Model("cyj"),
    brandId: "cyj",
    currentYearMonth: "2026-09",
  });
  assert.equal(result.status, "healthy");
  assert.equal(result.v2Expected, true);
  assert.equal(result.v2Active, true);
  assert.equal(result.cashPhase.reliable, true);
  assert.equal(result.accrualPhase.reliable, true);
  assert.deepEqual(result.sourceMonths, SOURCE_MONTHS);
  assert.equal(result.excludedStoreCount, 1);
});

test("Anniu V2 model remains brand-isolated", () => {
  const result = buildProjectionObservabilitySnapshot({
    model: makeV2Model("anniu"),
    brandId: "anniu",
    currentYearMonth: "2026-09",
  });
  assert.equal(result.status, "healthy");
  assert.equal(result.brandId, "anniu");
  assert.equal(result.v2Active, true);
});

test("Yibo remains standard projection and is not labeled smart-calibrated", () => {
  const model = {
    schemaVersion: "projection-model-v1",
    semanticVersion: "projection-semantic-v1",
    brandId: "yibo",
    modelMonth: "2026-09",
    sourceMonths: SOURCE_MONTHS,
    generatedAtText: "2026-09-08T08:24:48.586Z",
    stores: { A: {} },
    brand: {},
  };
  const result = buildProjectionObservabilitySnapshot({
    model,
    brandId: "yibo",
    currentYearMonth: "2026-09",
  });
  assert.equal(result.status, "healthy");
  assert.equal(result.v2Expected, false);
  assert.equal(result.v2Active, false);
  assert.equal(result.strategyLabel, "標準推估");
});

test("metric-specific reliability failure is surfaced as warning", () => {
  const model = makeV2Model("cyj");
  model.brand.phaseCalibration.accrual.reliable = false;
  model.brand.phaseCalibration.accrual.sourceMonthCount = 2;
  const result = buildProjectionObservabilitySnapshot({
    model,
    brandId: "cyj",
    currentYearMonth: "2026-09",
  });
  assert.equal(result.status, "warning");
  assert.equal(result.cashPhase.reliable, true);
  assert.equal(result.accrualPhase.reliable, false);
});

test("stale source-month lineage is surfaced as warning", () => {
  const model = makeV2Model("cyj");
  model.sourceMonths = ["2026-05", "2026-06", "2026-07"];
  model.brand.phaseCalibration.sourceMonths = model.sourceMonths;
  const result = buildProjectionObservabilitySnapshot({
    model,
    brandId: "cyj",
    currentYearMonth: "2026-09",
  });
  assert.equal(result.status, "warning");
  assert.equal(result.sourceMonthsCurrent, false);
});

test("cross-brand model mismatch is surfaced as error", () => {
  const result = buildProjectionObservabilitySnapshot({
    model: makeV2Model("cyj"),
    brandId: "anniu",
    currentYearMonth: "2026-09",
  });
  assert.equal(result.status, "error");
  assert.match(result.statusLabel, /品牌資料不一致/);
});

test("tone mapping is presentation-only", () => {
  assert.equal(getProjectionObservabilityTone("healthy"), "emerald");
  assert.equal(getProjectionObservabilityTone("warning"), "amber");
  assert.equal(getProjectionObservabilityTone("error"), "rose");
});


const makeAccuracyScore = (brandId = "cyj", yearMonth = "2026-08") => ({
  schemaVersion: "projection-accuracy-v1",
  semanticVersion: "projection-accuracy-checkpoint-v1",
  brandId,
  yearMonth,
  checkpointDays: [5, 7, 10, 15, 20, 25],
  checkpoints: {
    day05: {
      cutoffDate: `${yearMonth}-05`,
      cutoffDay: 5,
      model: {
        strategyVersion: brandId === "yibo" ? "projection-strategy-v1" : "projection-strategy-v2-phase-calibrated",
        runtimePhase: {
          cash: { phaseApplied: brandId !== "yibo" },
          accrual: { phaseApplied: brandId !== "yibo" },
        },
      },
    },
    day10: {
      cutoffDate: `${yearMonth}-10`,
      cutoffDay: 10,
      model: {
        strategyVersion: brandId === "yibo" ? "projection-strategy-v1" : "projection-strategy-v2-phase-calibrated",
        runtimePhase: {
          cash: { phaseApplied: brandId !== "yibo" },
          accrual: { phaseApplied: brandId !== "yibo" },
        },
      },
    },
  },
  finalActual: {
    source: "verified_dashboard_summary",
    cash: { value: 1000, status: "VALID" },
    accrual: { value: 1200, status: "VALID" },
    authority: {
      brandId,
      yearMonth,
    },
  },
  scoreMeta: {
    semanticVersion: "projection-accuracy-score-v1",
    scoreRevision: 2,
    scoredAtText: "2026-09-02T04:00:00.000Z",
  },
  scorecard: {
    overall: {
      cash: {
        effective: { count: 2, wapePct: 7.25, biasPct: -3.5, meanApePct: 7.1 },
        shadowV1: { count: 2, wapePct: 12.5, biasPct: -10, meanApePct: 12.4 },
        currentPace: { count: 2, wapePct: 9.75, biasPct: -8, meanApePct: 9.7 },
        effectiveV2AppliedOnly: { count: brandId === "yibo" ? 0 : 2, wapePct: brandId === "yibo" ? null : 7.25, biasPct: brandId === "yibo" ? null : -3.5 },
      },
      accrual: {
        effective: { count: 2, wapePct: 6.5, biasPct: -2.1, meanApePct: 6.4 },
        shadowV1: { count: 2, wapePct: 11.2, biasPct: -9.2, meanApePct: 11.1 },
        currentPace: { count: 2, wapePct: 8.8, biasPct: -7.4, meanApePct: 8.7 },
        effectiveV2AppliedOnly: { count: brandId === "yibo" ? 0 : 2, wapePct: brandId === "yibo" ? null : 6.5, biasPct: brandId === "yibo" ? null : -2.1 },
      },
    },
    byCheckpoint: {
      day05: {
        cutoffDate: `${yearMonth}-05`,
        cutoffDay: 5,
        cash: {
          effective: { eligible: true, reason: "SCORED", score: { forecast: 925, actual: 1000, apePct: 7.5, accuracyPctDisplay: 92.5, biasPct: -7.5 } },
          shadowV1: { eligible: true, reason: "SCORED", score: { forecast: 850, actual: 1000, apePct: 15, accuracyPctDisplay: 85, biasPct: -15 } },
          currentPace: { eligible: true, reason: "SCORED", score: { forecast: 900, actual: 1000, apePct: 10, accuracyPctDisplay: 90, biasPct: -10 } },
        },
        accrual: {
          effective: { eligible: true, reason: "SCORED", score: { forecast: 1128, actual: 1200, apePct: 6, accuracyPctDisplay: 94, biasPct: -6 } },
          shadowV1: { eligible: true, reason: "SCORED", score: { forecast: 1056, actual: 1200, apePct: 12, accuracyPctDisplay: 88, biasPct: -12 } },
          currentPace: { eligible: true, reason: "SCORED", score: { forecast: 1092, actual: 1200, apePct: 9, accuracyPctDisplay: 91, biasPct: -9 } },
        },
      },
      day10: {
        cutoffDate: `${yearMonth}-10`,
        cutoffDay: 10,
        cash: {
          effective: { eligible: true, reason: "SCORED", score: { forecast: 930, actual: 1000, apePct: 7, accuracyPctDisplay: 93, biasPct: -7 } },
          shadowV1: { eligible: true, reason: "SCORED", score: { forecast: 900, actual: 1000, apePct: 10, accuracyPctDisplay: 90, biasPct: -10 } },
          currentPace: { eligible: true, reason: "SCORED", score: { forecast: 905, actual: 1000, apePct: 9.5, accuracyPctDisplay: 90.5, biasPct: -9.5 } },
        },
        accrual: {
          effective: { eligible: true, reason: "SCORED", score: { forecast: 1116, actual: 1200, apePct: 7, accuracyPctDisplay: 93, biasPct: -7 } },
          shadowV1: { eligible: true, reason: "SCORED", score: { forecast: 1080, actual: 1200, apePct: 10, accuracyPctDisplay: 90, biasPct: -10 } },
          currentPace: { eligible: true, reason: "SCORED", score: { forecast: 1092, actual: 1200, apePct: 9, accuracyPctDisplay: 91, biasPct: -9 } },
        },
      },
    },
  },
});

test("B2B Accuracy observability consumes Backend persisted WAPE/Bias without recomputing", () => {
  const result = buildProjectionAccuracyObservabilitySnapshot({
    accuracy: makeAccuracyScore("cyj", "2026-08"),
    brandId: "cyj",
    yearMonth: "2026-08",
    currentYearMonth: "2026-09",
  });

  assert.equal(result.status, "healthy");
  assert.equal(result.scoringAvailable, true);
  assert.equal(result.scoreRevision, 2);
  assert.equal(result.finalActual.cash.value, 1000);
  assert.equal(result.metrics.cash.methods.effective.wapePct, 7.25);
  assert.equal(result.metrics.cash.methods.effective.biasPct, -3.5);
  assert.deepEqual(result.metrics.cash.bestMethods, ["effective"]);
  assert.equal(result.checkpointRows[0].cash.effective.apePct, 7.5);
  assert.equal(result.v2AppliedCheckpointCount.cash, 2);
});

test("B2B current month can show immutable checkpoint progress before Final Actual exists", () => {
  const accuracy = makeAccuracyScore("cyj", "2026-09");
  delete accuracy.finalActual;
  delete accuracy.scoreMeta;
  delete accuracy.scorecard;

  const result = buildProjectionAccuracyObservabilitySnapshot({
    accuracy,
    brandId: "cyj",
    yearMonth: "2026-09",
    currentYearMonth: "2026-09",
  });

  assert.equal(result.status, "warning");
  assert.equal(result.scoringAvailable, false);
  assert.equal(result.checkpointCount, 2);
  assert.match(result.statusLabel, /驗證時間點/);
});

test("B2B Accuracy trust fails closed on cross-brand or score semantic mismatch", () => {
  const crossBrand = buildProjectionAccuracyObservabilitySnapshot({
    accuracy: makeAccuracyScore("cyj", "2026-08"),
    brandId: "anniu",
    yearMonth: "2026-08",
    currentYearMonth: "2026-09",
  });
  assert.equal(crossBrand.status, "error");
  assert.match(crossBrand.statusLabel, /品牌資料不一致/);

  const incompatible = makeAccuracyScore("cyj", "2026-08");
  incompatible.scoreMeta.semanticVersion = "projection-accuracy-score-v999";
  const semantic = buildProjectionAccuracyObservabilitySnapshot({
    accuracy: incompatible,
    brandId: "cyj",
    yearMonth: "2026-08",
    currentYearMonth: "2026-09",
  });
  assert.equal(semantic.status, "error");
  assert.match(semantic.statusLabel, /月底驗證資料版本不相容/);
});

test("B2B Yibo remains V1 and never receives a V2 Accuracy label", () => {
  const result = buildProjectionAccuracyObservabilitySnapshot({
    accuracy: makeAccuracyScore("yibo", "2026-08"),
    brandId: "yibo",
    yearMonth: "2026-08",
    currentYearMonth: "2026-09",
  });

  assert.equal(result.status, "healthy");
  assert.equal(result.v2Expected, false);
  assert.equal(result.v2AppliedCheckpointCount.cash, 0);
  assert.equal(result.v2AppliedCheckpointCount.accrual, 0);
});

test("B2C.1 single-month read stays one point read and rolling history uses yearly point reads only", () => {
  const source = read("src/components/SmartForecastAccuracyPanel.jsx");

  const singleStart = source.indexOf("const loadAccuracy = useCallback");
  const singleEnd = source.indexOf("useEffect(() => {", singleStart);
  assert.ok(singleStart >= 0 && singleEnd > singleStart);
  const singleLoader = source.slice(singleStart, singleEnd);

  assert.match(
    singleLoader,
    /getDoc\(doc\(getCollectionPath\("projection_accuracy"\), selectedMonth\)\)/
  );
  assert.equal((singleLoader.match(/getDoc\(/g) || []).length, 1);
  assert.doesNotMatch(singleLoader, /getDocs\(/);
  assert.doesNotMatch(singleLoader, /onSnapshot\(/);
  assert.doesNotMatch(singleLoader, /setInterval\(/);
  assert.doesNotMatch(
    singleLoader,
    /daily_reports|monthly_aggregated|dashboard_summary|summary_recalc_flags/
  );
  assert.doesNotMatch(
    singleLoader,
    /setDoc\(|addDoc\(|updateDoc\(|writeBatch\(/
  );
  assert.match(singleLoader, /accuracyCacheRef/);
  assert.match(singleLoader, /accuracyRequestSeq/);

  const historyStart = source.indexOf("const loadHistory = useCallback");
  const historyEnd = source.indexOf("const openHistory = async", historyStart);
  assert.ok(historyStart >= 0 && historyEnd > historyStart);
  const historyLoader = source.slice(historyStart, historyEnd);

  assert.match(
    historyLoader,
    /getProjectionHistoryYearsForRange/
  );
  assert.match(
    historyLoader,
    /getDoc\(doc\(getCollectionPath\("projection_accuracy_history"\), year\)\)/
  );
  assert.equal((historyLoader.match(/getDoc\(/g) || []).length, 1);
  assert.doesNotMatch(historyLoader, /getDocs\(/);
  assert.doesNotMatch(historyLoader, /onSnapshot\(/);
  assert.doesNotMatch(historyLoader, /setInterval\(/);
  assert.doesNotMatch(
    historyLoader,
    /daily_reports|monthly_aggregated|dashboard_summary|summary_recalc_flags/
  );
  assert.doesNotMatch(
    historyLoader,
    /setDoc\(|addDoc\(|updateDoc\(|writeBatch\(/
  );
  assert.match(historyLoader, /historyCacheRef/);
  assert.match(historyLoader, /historyRequestSeq/);

  assert.match(source, />推估準確度<\/h2>/);
  assert.match(source, /自行選擇月份/);
  assert.match(source, /現金業績/);
  assert.match(source, /權責業績/);
  assert.match(source, /各日期比較/);
  assert.match(source, /historyDetailsOpen/);
  assert.match(source, /尚未開始累積|等待完整月份/);
  assert.doesNotMatch(source, /WAPE、Bias、APE/);
  assert.doesNotMatch(source, /Score Revision|Score Semantic|V2 eligible/);
});

test("B2C.1 month-level historical evidence supports selectable ranges and rolling live months", () => {
  assert.equal(getProjectionAccuracyDisplayPct(11.0574), 88.9426);
  assert.equal(describeProjectionBias(-7.703), "平均偏低 7.70%");
  assert.equal(describeProjectionBias(2.2582), "平均偏高 2.26%");
  assert.equal(PROJECTION_ACCURACY_METHOD_LABELS.effective, "目前使用的推估方式");
  assert.equal(PROJECTION_HISTORICAL_METHOD_LABELS.effective, "智慧校正推估");

  const cyj = buildProjectionHistoricalAccuracyComparison({ brandId: "cyj" });
  assert.equal(cyj.available, true);
  assert.deepEqual(cyj.targetMonths, ["2026-05", "2026-06", "2026-07", "2026-08"]);
  assert.equal(cyj.trustedMonthCount, 4);
  assert.equal(cyj.metrics.cash.overall.methods.effective.accuracyPct, 88.9426);
  assert.deepEqual(cyj.metrics.cash.overall.bestMethods, ["effective"]);
  assert.deepEqual(
    cyj.metrics.cash.checkpoints.find((row) => row.day === 25)?.bestMethods,
    ["currentPace"]
  );

  const cyjMayJune = buildProjectionHistoricalAccuracyComparison({
    brandId: "cyj",
    startMonth: "2026-05",
    endMonth: "2026-06",
  });
  assert.deepEqual(cyjMayJune.targetMonths, ["2026-05", "2026-06"]);
  assert.equal(cyjMayJune.trustedMonthCount, 2);
  assert.equal(cyjMayJune.metrics.cash.overall.methods.effective.count, 12);
  assert.equal(cyjMayJune.metrics.cash.overall.methods.effective.accuracyPct, 91.3651);
  assert.notEqual(
    cyjMayJune.metrics.cash.overall.methods.effective.accuracyPct,
    cyj.metrics.cash.overall.methods.effective.accuracyPct
  );

  const seedOctober = structuredClone(PROJECTION_ACCURACY_HISTORICAL_EVIDENCE.brands.cyj.months["2026-08"]);
  seedOctober.yearMonth = "2026-10";
  seedOctober.evidenceType = "live_checkpoint";
  seedOctober.scoreSemanticVersion = "projection-accuracy-score-v1";
  seedOctober.scoreRevision = 1;
  seedOctober.inputSignature = "live-october-signature";
  Object.values(seedOctober.checkpoints).forEach((checkpoint) => {
    checkpoint.cutoffDate = `2026-10-${String(checkpoint.cutoffDay).padStart(2, "0")}`;
  });
  const rolling = buildProjectionHistoricalAccuracyComparison({
    brandId: "cyj",
    liveHistoryDocuments: [{
      schemaVersion: "projection-accuracy-history-v1",
      comparisonMode: "v2_vs_v1_vs_pace",
      statisticsVersion: "normalized-wape-components-v1",
      brandId: "cyj",
      year: "2026",
      months: { "2026-10": seedOctober },
    }],
  });
  assert.deepEqual(rolling.targetMonths, ["2026-06", "2026-07", "2026-08", "2026-10"]);
  assert.equal(rolling.liveMonthCount, 1);
  assert.equal(rolling.historicalBacktestMonthCount, 3);

  const anniu = buildProjectionHistoricalAccuracyComparison({ brandId: "anniu" });
  assert.equal(anniu.available, true);
  assert.equal(anniu.metrics.accrual.overall.methods.effective.accuracyPct, 91.563);

  const yibo = buildProjectionHistoricalAccuracyComparison({ brandId: "yibo" });
  assert.equal(yibo.available, false);
  assert.match(yibo.statusDetail, /不同口徑資料補值/);

  assert.deepEqual(
    getProjectionHistoryYearsForRange({ startMonth: "2026-05", endMonth: "2027-02" }),
    ["2026", "2027"]
  );
  assert.deepEqual(
    getProjectionHistoryYearsForRange({ startMonth: "2027-02", endMonth: "2026-05" }),
    []
  );
});

test("B2C.1 historical backtest stays immutable and separate from rolling Firestore evidence", () => {
  const evidenceSource = read("src/data/projectionAccuracyHistoricalEvidence.js");
  const uiSource = read("src/components/SmartForecastAccuracyPanel.jsx");

  assert.equal(Object.isFrozen(PROJECTION_ACCURACY_HISTORICAL_EVIDENCE), true);
  assert.equal(
    Object.isFrozen(PROJECTION_ACCURACY_HISTORICAL_EVIDENCE.brands.cyj.months["2026-05"].checkpoints.day05.cash),
    true
  );
  assert.match(evidenceSource, /projection-accuracy-historical-evidence-v2/);
  assert.match(evidenceSource, /historical_backtest/);
  assert.match(evidenceSource, /normalized-wape-components-v1/);
  assert.match(evidenceSource, /actualWeight/);
  assert.doesNotMatch(evidenceSource, /33377364|37544307|32196527|30397230/);
  assert.match(evidenceSource, /01fd6c14e4029783be362d764087e1979a93f69d793aa5e3e6e02723e3fc4da6/);
  assert.doesNotMatch(evidenceSource, /getDoc\(|getDocs\(|onSnapshot\(|setDoc\(|addDoc\(|updateDoc\(|writeBatch\(|setInterval\(/);

  assert.match(uiSource, /const liveHistoryDocuments = useMemo/);
  assert.match(uiSource, /歷史回看資料與正式累積資料會分開保存/);
  assert.match(uiSource, /不會補寫成過去的單月追蹤紀錄/);
});

test("B2B Accuracy contracts stay aligned with B2A writer and existing frontend-read-only Rules", () => {
  const backend = read("functions/projectionAccuracy.js");
  const rules = read("firestore.rules");

  assert.match(backend, /PROJECTION_ACCURACY_SCORE_SEMANTIC_VERSION = "projection-accuracy-score-v1"/);
  assert.match(backend, /PROJECTION_ACCURACY_FINAL_ACTUAL_SOURCE = "verified_dashboard_summary"/);
  assert.match(backend, /scorecard,\s*scoreMeta:/);
  assert.match(backend, /finalActual:/);

  assert.match(
    rules,
    /match \/brands\/\{brandId\}\/projection_accuracy\/\{document=\*\*\} \{[\s\S]*?allow read: if signedIn\(\);[\s\S]*?allow write: if false;/
  );
  assert.match(
    rules,
    /match \/artifacts\/\{appId\}\/public\/data\/projection_accuracy\/\{document=\*\*\} \{[\s\S]*?allow read: if signedIn\(\);[\s\S]*?allow write: if false;/
  );
  assert.match(
    rules,
    /match \/brands\/\{brandId\}\/projection_accuracy_history\/\{document=\*\*\} \{[\s\S]*?allow read: if signedIn\(\);[\s\S]*?allow write: if false;/
  );
  assert.match(
    rules,
    /match \/artifacts\/\{appId\}\/public\/data\/projection_accuracy_history\/\{document=\*\*\} \{[\s\S]*?allow read: if signedIn\(\);[\s\S]*?allow write: if false;/
  );
  assert.equal((rules.match(/collectionName != 'projection_accuracy_history'/g) || []).length, 2);
});

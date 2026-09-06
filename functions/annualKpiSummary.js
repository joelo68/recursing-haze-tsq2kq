// functions/annualKpiSummary.js
// Batch 7 Annual KPI benchmark pure semantics.
// Firestore orchestration stays in functions/index.js; this file owns only deterministic
// trust/validity/sample aggregation so Frontend/Backend behavior can be regression-tested.

const ANNUAL_KPI_SUMMARY_SCHEMA_VERSION = "annual-kpi-summary-v2";
const REPORTING_COMPLETENESS_SCHEMA_VERSION = "reporting-completeness-v1";

const { KPI_VALUE_STATUS } = require("./kpiContracts");

const ANNUAL_KPI_METRIC_DEFINITIONS = Object.freeze({
  traffic: Object.freeze({ valueKey: "traffic", statusKey: "trafficStatus" }),
  newCustomers: Object.freeze({ valueKey: "newCustomers", statusKey: "newCustomersStatus" }),
  cash: Object.freeze({ valueKey: "formalNetCash", statusKey: "formalNetCashStatus" }),
  accrual: Object.freeze({ valueKey: "formalAccrual", statusKey: "formalAccrualStatus" }),
});

const normalizeText = (value = "") => String(value || "").trim();
const normalizeBrandId = (value = "") => normalizeText(value).toLowerCase();

const normalizeYearMonth = (value = "") => {
  const text = normalizeText(value);
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(text) ? text : "";
};

const isValidNumericStatus = (status) => (
  status === KPI_VALUE_STATUS.VALID || status === KPI_VALUE_STATUS.VALID_ZERO
);

const inspectAnnualSummaryFlag = (flag = null) => {
  if (!flag || typeof flag !== "object") {
    return {
      status: "none",
      mismatchCount: 0,
      pendingCount: 0,
      isVerified: false,
      isDirty: true,
    };
  }

  const status = normalizeText(flag.status).toLowerCase();
  const mismatchCount = Number(flag.lastMismatchCount ?? flag.mismatchCount ?? 0);
  const pendingCount = Number(flag.pendingCount ?? 0);
  const isVerified = ["completed", "verified"].includes(status)
    && flag.dirty !== true
    && mismatchCount === 0
    && pendingCount === 0;
  const isCompleteStatus = ["completed", "verified", "idle"].includes(status);
  const isDirty = flag.dirty === true || !isCompleteStatus || mismatchCount > 0 || pendingCount > 0;

  return {
    status: status || "none",
    mismatchCount,
    pendingCount,
    isVerified,
    isDirty,
  };
};

function inspectAnnualKpiSummarySourceTrust({
  summary = null,
  summaryFlag = null,
  yearMonth = "",
  brandId = "",
  expectedSummarySemanticVersion = "",
  lifecycleRevision = null,
  systemExclusionCurrent = false,
} = {}) {
  const ym = normalizeYearMonth(yearMonth);
  const expectedBrand = normalizeBrandId(brandId);

  if (!summary || typeof summary !== "object") {
    return { trusted: false, reason: "SUMMARY_MISSING" };
  }
  if (!ym) {
    return { trusted: false, reason: "INVALID_PERIOD" };
  }

  const summaryMonth = normalizeYearMonth(summary.yearMonth || summary.id);
  if (summaryMonth !== ym) {
    return { trusted: false, reason: "SUMMARY_MONTH_MISMATCH" };
  }

  const summaryBrand = normalizeBrandId(summary.brandId);
  if (!expectedBrand || summaryBrand !== expectedBrand) {
    return { trusted: false, reason: "SUMMARY_BRAND_MISMATCH" };
  }

  if (expectedSummarySemanticVersion
      && normalizeText(summary.semanticVersion) !== normalizeText(expectedSummarySemanticVersion)) {
    return { trusted: false, reason: "SUMMARY_SEMANTIC_VERSION_MISMATCH" };
  }

  const lifecycleSnapshot = summary.lifecycleSnapshot && typeof summary.lifecycleSnapshot === "object"
    ? summary.lifecycleSnapshot
    : null;
  if (!lifecycleSnapshot || normalizeText(lifecycleSnapshot.datasetStatus) !== "READY") {
    return { trusted: false, reason: "LIFECYCLE_SNAPSHOT_UNAVAILABLE" };
  }

  if (lifecycleRevision !== null && lifecycleRevision !== undefined) {
    const currentRevision = Number(lifecycleRevision);
    const storedRevision = Number(lifecycleSnapshot.revision);
    if (!Number.isFinite(currentRevision)
        || !Number.isFinite(storedRevision)
        || storedRevision !== currentRevision) {
      return { trusted: false, reason: "LIFECYCLE_SUMMARY_REVISION_MISMATCH" };
    }
  }

  const reporting = summary.reportingCompleteness && typeof summary.reportingCompleteness === "object"
    ? summary.reportingCompleteness
    : null;
  if (!reporting || normalizeText(reporting.schemaVersion) !== REPORTING_COMPLETENESS_SCHEMA_VERSION) {
    return { trusted: false, reason: "REPORTING_COMPLETENESS_UNAVAILABLE" };
  }

  if (systemExclusionCurrent !== true) {
    return { trusted: false, reason: "SYSTEM_EXCLUSION_SUMMARY_REVISION_MISMATCH" };
  }

  if (!summaryFlag || typeof summaryFlag !== "object") {
    return { trusted: false, reason: "FLAG_MISSING" };
  }

  const flagMonth = normalizeYearMonth(
    summaryFlag.affectedYearMonth || summaryFlag.yearMonth || summaryFlag.id || ym
  );
  if (flagMonth !== ym) {
    return { trusted: false, reason: "FLAG_MONTH_MISMATCH" };
  }

  const flagBrand = normalizeBrandId(summaryFlag.brandId || expectedBrand);
  if (flagBrand !== expectedBrand) {
    return { trusted: false, reason: "FLAG_BRAND_MISMATCH" };
  }

  const flagState = inspectAnnualSummaryFlag(summaryFlag);
  if (flagState.pendingCount > 0) {
    return { trusted: false, reason: "SUMMARY_PENDING" };
  }
  if (!flagState.isVerified) {
    return {
      trusted: false,
      reason: flagState.isDirty ? "SUMMARY_DIRTY" : "SUMMARY_UNVERIFIED",
    };
  }

  return { trusted: true, reason: "VERIFIED_FORMAL_SUMMARY" };
}

const readMetric = (row = {}, metricId = "") => {
  const definition = ANNUAL_KPI_METRIC_DEFINITIONS[metricId];
  if (!definition) return { valid: false, value: null, status: KPI_VALUE_STATUS.DATA_INVALID };

  const status = normalizeText(row?.[definition.statusKey]);
  const raw = row?.[definition.valueKey];
  const value = raw === null || raw === undefined || raw === "" ? null : Number(raw);
  if (!isValidNumericStatus(status) || !Number.isFinite(value)) {
    return {
      valid: false,
      value: null,
      status: status || KPI_VALUE_STATUS.FIELD_MISSING,
    };
  }

  return {
    valid: true,
    value,
    status: value === 0 ? KPI_VALUE_STATUS.VALID_ZERO : KPI_VALUE_STATUS.VALID,
  };
};

const finalizeMetricSummary = (monthlyValues = {}, skippedMonths = []) => {
  const normalizedValues = Object.fromEntries(
    Object.entries(monthlyValues || {})
      .filter(([yearMonth, value]) => normalizeYearMonth(yearMonth) && Number.isFinite(Number(value)))
      .map(([yearMonth, value]) => [yearMonth, Number(value)])
      .sort(([a], [b]) => a.localeCompare(b))
  );
  const basedMonths = Object.keys(normalizedValues);
  const total = basedMonths.reduce((sum, yearMonth) => sum + normalizedValues[yearMonth], 0);
  const basedMonthCount = basedMonths.length;
  const monthlyAverage = basedMonthCount > 0 ? Math.round(total / basedMonthCount) : null;

  return {
    monthlyValues: normalizedValues,
    total: basedMonthCount > 0 ? total : null,
    monthlyAverage,
    basedMonths,
    basedMonthCount,
    status: basedMonthCount === 0
      ? KPI_VALUE_STATUS.N_A
      : (total === 0 ? KPI_VALUE_STATUS.VALID_ZERO : KPI_VALUE_STATUS.VALID),
    skippedMonths: Array.isArray(skippedMonths)
      ? [...skippedMonths].sort((a, b) => String(a?.yearMonth || "").localeCompare(String(b?.yearMonth || "")))
      : [],
  };
};

const buildLegacyMonthlyValues = (metrics = {}) => {
  const allMonths = new Set();
  Object.values(metrics || {}).forEach((metric) => {
    Object.keys(metric?.monthlyValues || {}).forEach((yearMonth) => allMonths.add(yearMonth));
  });

  const result = {};
  [...allMonths].sort().forEach((yearMonth) => {
    result[yearMonth] = {
      traffic: metrics?.traffic?.monthlyValues?.[yearMonth],
      newCustomers: metrics?.newCustomers?.monthlyValues?.[yearMonth],
      cash: metrics?.cash?.monthlyValues?.[yearMonth],
      accrual: metrics?.accrual?.monthlyValues?.[yearMonth],
    };
  });
  return result;
};

function buildAnnualKpiSummaryPayload({
  brandId = "",
  brandLabel = "",
  year = 0,
  candidateMonths = [],
  monthInputs = [],
  lifecycleRevision = 0,
  systemExclusionSnapshot = null,
  trigger = "manual",
  updatedAtText = "",
} = {}) {
  const normalizedBrandId = normalizeBrandId(brandId);
  const storeWorking = {};
  const brandWorking = Object.fromEntries(
    Object.keys(ANNUAL_KPI_METRIC_DEFINITIONS).map((metricId) => [
      metricId,
      { monthlyValues: {}, skippedMonths: [] },
    ])
  );
  const benchmarkScopeByMonth = {};
  const skippedMonths = [];
  const sourceTrustByMonth = {};

  const months = new Map();
  (Array.isArray(monthInputs) ? monthInputs : []).forEach((input) => {
    const ym = normalizeYearMonth(input?.yearMonth);
    if (ym && !months.has(ym)) months.set(ym, input || {});
  });

  (Array.isArray(candidateMonths) ? candidateMonths : []).forEach((rawYearMonth) => {
    const yearMonth = normalizeYearMonth(rawYearMonth);
    if (!yearMonth) return;
    const input = months.get(yearMonth) || null;

    if (!input) {
      const reason = "MONTH_INPUT_MISSING";
      skippedMonths.push({ yearMonth, reason });
      sourceTrustByMonth[yearMonth] = { trusted: false, reason };
      Object.keys(brandWorking).forEach((metricId) => {
        brandWorking[metricId].skippedMonths.push({ yearMonth, reason });
      });
      return;
    }

    const trust = input.trust && typeof input.trust === "object"
      ? input.trust
      : { trusted: false, reason: "SOURCE_UNTRUSTED" };
    sourceTrustByMonth[yearMonth] = {
      trusted: trust.trusted === true,
      reason: normalizeText(trust.reason || (trust.trusted ? "VERIFIED_FORMAL_SUMMARY" : "SOURCE_UNTRUSTED")),
    };

    if (trust.trusted !== true) {
      const reason = normalizeText(trust.reason) || "SOURCE_UNTRUSTED";
      skippedMonths.push({ yearMonth, reason });
      Object.keys(brandWorking).forEach((metricId) => {
        brandWorking[metricId].skippedMonths.push({ yearMonth, reason });
      });
      return;
    }

    const requiredStoreKeys = [...new Set(
      (Array.isArray(input.requiredStoreKeys) ? input.requiredStoreKeys : [])
        .map(normalizeText)
        .filter(Boolean)
    )].sort((a, b) => a.localeCompare(b, "zh-Hant"));

    benchmarkScopeByMonth[yearMonth] = {
      requiredStoreKeys,
      requiredStoreCount: requiredStoreKeys.length,
    };

    if (requiredStoreKeys.length === 0) {
      const reason = "NO_FULL_MONTH_FORMAL_STORES";
      skippedMonths.push({ yearMonth, reason });
      Object.keys(brandWorking).forEach((metricId) => {
        brandWorking[metricId].skippedMonths.push({ yearMonth, reason });
      });
      return;
    }

    const storesByCore = input.storesByCore && typeof input.storesByCore === "object"
      ? input.storesByCore
      : {};
    const reportingByCore = input.reportingByCore && typeof input.reportingByCore === "object"
      ? input.reportingByCore
      : {};

    requiredStoreKeys.forEach((storeCore) => {
      if (!storeWorking[storeCore]) {
        const row = storesByCore[storeCore] || {};
        storeWorking[storeCore] = {
          storeCore,
          storeName: normalizeText(row.displayName || row.storeName || row.name) || `${storeCore}店`,
          metrics: Object.fromEntries(
            Object.keys(ANNUAL_KPI_METRIC_DEFINITIONS).map((metricId) => [
              metricId,
              { monthlyValues: {}, skippedMonths: [] },
            ])
          ),
        };
      }

      const row = storesByCore[storeCore] || null;
      const reporting = reportingByCore[storeCore] || null;
      const reportingComplete = reporting?.reportingStatus === "DATA_COMPLETE";
      const formalEligible = row?.formalLifecycleEligible === true;

      Object.keys(ANNUAL_KPI_METRIC_DEFINITIONS).forEach((metricId) => {
        let skipReason = "";
        let metric = { valid: false, value: null, status: KPI_VALUE_STATUS.FIELD_MISSING };

        if (!row) skipReason = "SUMMARY_STORE_MISSING";
        else if (!formalEligible) skipReason = "FORMAL_STORE_NOT_ELIGIBLE";
        else if (!reporting) skipReason = "REPORTING_STORE_MISSING";
        else if (!reportingComplete) skipReason = "REPORTING_DATA_INCOMPLETE";
        else {
          metric = readMetric(row, metricId);
          if (!metric.valid) skipReason = metric.status || "METRIC_INVALID";
        }

        if (skipReason) {
          storeWorking[storeCore].metrics[metricId].skippedMonths.push({
            yearMonth,
            reason: skipReason,
          });
          return;
        }

        storeWorking[storeCore].metrics[metricId].monthlyValues[yearMonth] = metric.value;
      });
    });

    Object.keys(ANNUAL_KPI_METRIC_DEFINITIONS).forEach((metricId) => {
      const invalidStoreKeys = [];
      let monthTotal = 0;

      requiredStoreKeys.forEach((storeCore) => {
        const value = storeWorking?.[storeCore]?.metrics?.[metricId]?.monthlyValues?.[yearMonth];
        if (!Number.isFinite(Number(value))) {
          invalidStoreKeys.push(storeCore);
          return;
        }
        monthTotal += Number(value);
      });

      if (invalidStoreKeys.length > 0) {
        brandWorking[metricId].skippedMonths.push({
          yearMonth,
          reason: "SCOPE_KPI_INCOMPLETE",
          invalidStoreKeys,
        });
        return;
      }

      brandWorking[metricId].monthlyValues[yearMonth] = monthTotal;
    });
  });

  const metrics = Object.fromEntries(
    Object.entries(brandWorking).map(([metricId, state]) => [
      metricId,
      finalizeMetricSummary(state.monthlyValues, state.skippedMonths),
    ])
  );

  const stores = Object.fromEntries(
    Object.entries(storeWorking)
      .map(([storeCore, store]) => {
        const storeMetrics = Object.fromEntries(
          Object.entries(store.metrics).map(([metricId, state]) => [
            metricId,
            finalizeMetricSummary(state.monthlyValues, state.skippedMonths),
          ])
        );
        const trafficMetric = storeMetrics.traffic;
        const newCustomerMetric = storeMetrics.newCustomers;
        const cashMetric = storeMetrics.cash;
        const accrualMetric = storeMetrics.accrual;

        return [storeCore, {
          storeCore,
          storeName: store.storeName,
          metrics: storeMetrics,

          // Compatibility fields. V2 consumers must use metrics.<kpi>.
          monthlyValues: buildLegacyMonthlyValues(storeMetrics),
          basedMonths: trafficMetric.basedMonths,
          basedMonthCount: trafficMetric.basedMonthCount,
          trafficTotal: trafficMetric.total ?? 0,
          newCustomerTotal: newCustomerMetric.total ?? 0,
          cashTotal: cashMetric.total ?? 0,
          accrualTotal: accrualMetric.total ?? 0,
          trafficMonthlyAverage: trafficMetric.monthlyAverage ?? 0,
          newCustomerMonthlyAverage: newCustomerMetric.monthlyAverage ?? 0,
          cashMonthlyAverage: cashMetric.monthlyAverage ?? 0,
          accrualMonthlyAverage: accrualMetric.monthlyAverage ?? 0,
          legacyBasedMetric: "traffic",
        }];
      })
      .sort(([a], [b]) => a.localeCompare(b, "zh-Hant"))
  );

  const trafficMetric = metrics.traffic;
  const newCustomerMetric = metrics.newCustomers;
  const cashMetric = metrics.cash;
  const accrualMetric = metrics.accrual;

  return {
    schemaVersion: ANNUAL_KPI_SUMMARY_SCHEMA_VERSION,
    brandId: normalizedBrandId,
    brandLabel: normalizeText(brandLabel),
    year: Number(year) || 0,
    yearText: String(Number(year) || ""),
    source: "dashboard_summary",
    basis: "lifecycle_full_month_data_complete_kpi_specific",
    scopeSupport: "brand_store_manager",
    lifecycleRevision: Number(lifecycleRevision || 0),
    systemExclusionSnapshot: systemExclusionSnapshot && typeof systemExclusionSnapshot === "object"
      ? { ...systemExclusionSnapshot }
      : null,
    metrics,
    benchmarkScopeByMonth,
    sourceTrustByMonth,
    stores,
    storeCount: Object.keys(stores).length,
    skippedMonths: [...skippedMonths].sort((a, b) => String(a?.yearMonth || "").localeCompare(String(b?.yearMonth || ""))),
    candidateMonths: (Array.isArray(candidateMonths) ? candidateMonths : []).map(normalizeYearMonth).filter(Boolean),

    // Compatibility fields for a staged migration. The shared basedMonths fields
    // intentionally mirror traffic only; V2 consumers must use metrics.<kpi>.
    trafficTotal: trafficMetric.total ?? 0,
    newCustomerTotal: newCustomerMetric.total ?? 0,
    cashTotal: cashMetric.total ?? 0,
    accrualTotal: accrualMetric.total ?? 0,
    trafficMonthlyAverage: trafficMetric.monthlyAverage ?? 0,
    newCustomerMonthlyAverage: newCustomerMetric.monthlyAverage ?? 0,
    cashMonthlyAverage: cashMetric.monthlyAverage ?? 0,
    accrualMonthlyAverage: accrualMetric.monthlyAverage ?? 0,
    monthlyValues: buildLegacyMonthlyValues(metrics),
    basedMonths: trafficMetric.basedMonths,
    basedMonthCount: trafficMetric.basedMonthCount,
    legacyBasedMetric: "traffic",

    trigger: normalizeText(trigger) || "manual",
    updatedAtText: normalizeText(updatedAtText),
  };
}

module.exports = {
  ANNUAL_KPI_SUMMARY_SCHEMA_VERSION,
  ANNUAL_KPI_METRIC_DEFINITIONS,
  KPI_VALUE_STATUS,
  inspectAnnualSummaryFlag,
  inspectAnnualKpiSummarySourceTrust,
  readMetric,
  finalizeMetricSummary,
  buildAnnualKpiSummaryPayload,
};

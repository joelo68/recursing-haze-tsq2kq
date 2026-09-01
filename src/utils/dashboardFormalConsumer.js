import { KPI_CONTRACT_VERSION, KPI_VALUE_STATUS, validBaseTarget } from "./kpiContracts.js";
import { resolveTargetAuthorityConflict } from "./targetAuthorityConflict.js";
import {
  SUMMARY_KPI_STATUS,
  SUMMARY_SEMANTIC_VERSION,
  buildScopeFormalAchievement,
  buildSummaryTargetAuthoritySnapshot,
  extractTargetCoverageMetadata,
} from "./summarySemantics.js";

export const DASHBOARD_SUMMARY_VERSION = "dashboard-summary-v2";

const isValidNumericStatus = (status) => (
  status === KPI_VALUE_STATUS.VALID || status === KPI_VALUE_STATUS.VALID_ZERO
);

const normalizeIdentity = (value = "") => String(value || "").trim();

const mergeAggregateStatus = (current, next) => {
  if (current === KPI_VALUE_STATUS.DATA_INVALID || next === KPI_VALUE_STATUS.DATA_INVALID) {
    return KPI_VALUE_STATUS.DATA_INVALID;
  }
  if (current === KPI_VALUE_STATUS.FIELD_MISSING || next === KPI_VALUE_STATUS.FIELD_MISSING) {
    return KPI_VALUE_STATUS.FIELD_MISSING;
  }
  return KPI_VALUE_STATUS.VALID;
};

const aggregateStoredFormalMetric = (rows = [], valueKey, statusKey) => {
  if (!Array.isArray(rows) || rows.length === 0) {
    return { value: null, status: KPI_VALUE_STATUS.FIELD_MISSING };
  }

  let total = 0;
  let status = KPI_VALUE_STATUS.VALID;
  let count = 0;

  rows.forEach((row) => {
    const rowStatus = String(row?.[statusKey] || KPI_VALUE_STATUS.FIELD_MISSING);
    const rawValue = row?.[valueKey];
    const numeric = Number(rawValue);
    const hasFiniteValue = rawValue !== null && rawValue !== undefined && rawValue !== "" && Number.isFinite(numeric);
    const effectiveStatus = isValidNumericStatus(rowStatus) && hasFiniteValue
      ? rowStatus
      : (rowStatus === KPI_VALUE_STATUS.DATA_INVALID ? KPI_VALUE_STATUS.DATA_INVALID : KPI_VALUE_STATUS.FIELD_MISSING);

    status = mergeAggregateStatus(status, effectiveStatus);
    count += 1;
    if (isValidNumericStatus(effectiveStatus)) total += numeric;
  });

  if (!count || !isValidNumericStatus(status)) return { value: null, status };
  return {
    value: total,
    status: total === 0 ? KPI_VALUE_STATUS.VALID_ZERO : KPI_VALUE_STATUS.VALID,
  };
};

const choosePreferredTargetRow = (current, incoming, storeKey = "") => {
  if (!current) return incoming;

  const currentCanonical = current?.isCanonicalSource === true;
  const incomingCanonical = incoming?.isCanonicalSource === true;
  const conflict = resolveTargetAuthorityConflict(current, incoming, {
    currentAuthoritative: currentCanonical,
    incomingAuthoritative: incomingCanonical,
    storeName: storeKey,
    canonicalTargetId: current?.canonicalTargetId || incoming?.canonicalTargetId || "",
  });
  if (conflict) return conflict;

  if (currentCanonical !== incomingCanonical) return incomingCanonical ? incoming : current;

  const score = (row = {}) => (
    (validBaseTarget(row.cashTarget).valid ? 1 : 0) +
    (validBaseTarget(row.accrualTarget).valid ? 1 : 0)
  );
  const currentScore = score(current);
  const incomingScore = score(incoming);
  if (currentScore !== incomingScore) return incomingScore > currentScore ? incoming : current;

  return String(incoming?.sourceDocId || incoming?.id || "").localeCompare(
    String(current?.sourceDocId || current?.id || ""),
    "zh-Hant"
  ) > 0 ? incoming : current;
};

export const normalizeMonthlyTargetMap = (targetSummary = {}, normalizeStoreKey = normalizeIdentity) => {
  const rawTargets = targetSummary?.targets || targetSummary?.storeTargets || targetSummary?.data || {};
  const entries = Array.isArray(rawTargets)
    ? rawTargets.map((row, index) => [String(index), row])
    : Object.entries(rawTargets && typeof rawTargets === "object" ? rawTargets : {});
  const normalized = {};

  entries.forEach(([key, row]) => {
    if (!row || typeof row !== "object") return;
    const storeKey = normalizeStoreKey(
      row.storeName || row.store || row.coreStoreName || row.canonicalStoreName || key
    );
    if (!storeKey) return;
    normalized[storeKey] = choosePreferredTargetRow(normalized[storeKey], row, storeKey);
  });

  return normalized;
};

export const isFormalDashboardSummaryCompatible = (summary = {}) => (
  String(summary?.version || "") === DASHBOARD_SUMMARY_VERSION &&
  String(summary?.semanticVersion || "") === SUMMARY_SEMANTIC_VERSION &&
  String(summary?.kpiContractVersion || "") === KPI_CONTRACT_VERSION &&
  summary?.stores && typeof summary.stores === "object"
);

const buildLiveTargetAuthority = ({ summary, monthlyTargetSummary, normalizeStoreKey }) => {
  const summaryMonth = String(summary?.yearMonth || summary?.id || "");
  const targetMonth = String(monthlyTargetSummary?.yearMonth || monthlyTargetSummary?.id || "");
  const hasMatchingTargetSummary = Boolean(monthlyTargetSummary) && (!summaryMonth || !targetMonth || summaryMonth === targetMonth);
  const lifecycle = summary?.lifecycleSnapshot || {};
  const lifecycleReady = String(lifecycle?.datasetStatus || "") === "READY";
  const eligibleStoreKeys = Array.isArray(lifecycle?.eligibleStoreKeys)
    ? lifecycle.eligibleStoreKeys.map(normalizeStoreKey).filter(Boolean)
    : [];

  if (!hasMatchingTargetSummary) {
    return {
      authority: buildSummaryTargetAuthoritySnapshot({
        targetMap: {},
        eligibleStoreKeys,
        lifecycleReady,
        targetCoverage: {},
      }),
      targetMap: {},
      targetSummaryAvailable: false,
    };
  }

  const targetMap = normalizeMonthlyTargetMap(monthlyTargetSummary, normalizeStoreKey);
  const targetCoverage = extractTargetCoverageMetadata(monthlyTargetSummary);
  return {
    authority: buildSummaryTargetAuthoritySnapshot({
      targetMap,
      eligibleStoreKeys,
      lifecycleReady,
      targetCoverage,
    }),
    targetMap,
    targetSummaryAvailable: true,
  };
};

const buildScopeTarget = ({ scopeKeys, targetMap, authority, metric }) => {
  const isCash = metric === "cash";
  const field = isCash ? "cashTarget" : "accrualTarget";
  let configured = 0;
  let total = 0;
  const missing = [];

  scopeKeys.forEach((storeKey) => {
    const target = validBaseTarget(targetMap?.[storeKey]?.[field]);
    if (target.valid) {
      configured += 1;
      total += target.value;
    } else {
      missing.push(storeKey);
    }
  });

  const coverageConsistent = authority?.coverageConsistent === true;
  const complete = coverageConsistent && scopeKeys.length > 0 && missing.length === 0;
  return {
    value: complete ? total : null,
    status: complete ? (total === 0 ? KPI_VALUE_STATUS.VALID_ZERO : KPI_VALUE_STATUS.VALID) : SUMMARY_KPI_STATUS.TARGET_INCOMPLETE,
    configuredStoreCount: configured,
    eligibleStoreCount: scopeKeys.length,
    missingStoreKeys: missing,
    coverageComplete: complete,
  };
};

export const buildHistoricalFormalDashboardScope = ({
  summary = {},
  stores = [],
  monthlyTargetSummary = null,
  normalizeStoreKey = normalizeIdentity,
  filtered = false,
} = {}) => {
  if (!isFormalDashboardSummaryCompatible(summary)) {
    return { compatible: false, reason: "FORMAL_SUMMARY_CONTRACT_MISSING" };
  }

  const { authority, targetMap, targetSummaryAvailable } = buildLiveTargetAuthority({
    summary,
    monthlyTargetSummary,
    normalizeStoreKey,
  });
  const lifecycleEligible = new Set((authority?.eligibleStoreKeys || []).map(normalizeStoreKey).filter(Boolean));

  const scopedEligibleStores = (Array.isArray(stores) ? stores : []).filter((store) => {
    const storeKey = normalizeStoreKey(
      store?.__summaryKey || store?.store || store?.storeName || store?.displayName || store?.name || store?.id || ""
    );
    return storeKey && lifecycleEligible.has(storeKey);
  });
  const scopeKeys = [...new Set(scopedEligibleStores.map((store) => normalizeStoreKey(
    store?.__summaryKey || store?.store || store?.storeName || store?.displayName || store?.name || store?.id || ""
  )).filter(Boolean))];

  let cashActual;
  let accrualActual;
  if (filtered) {
    cashActual = aggregateStoredFormalMetric(scopedEligibleStores, "formalNetCash", "formalNetCashStatus");
    accrualActual = aggregateStoredFormalMetric(scopedEligibleStores, "formalAccrual", "formalAccrualStatus");
  } else {
    const grand = summary?.grandTotal || {};
    cashActual = {
      value: isValidNumericStatus(grand.formalNetCashStatus) && Number.isFinite(Number(grand.formalNetCash))
        ? Number(grand.formalNetCash)
        : null,
      status: String(grand.formalNetCashStatus || KPI_VALUE_STATUS.FIELD_MISSING),
    };
    accrualActual = {
      value: isValidNumericStatus(grand.formalAccrualStatus) && Number.isFinite(Number(grand.formalAccrual))
        ? Number(grand.formalAccrual)
        : null,
      status: String(grand.formalAccrualStatus || KPI_VALUE_STATUS.FIELD_MISSING),
    };
  }

  const cashTarget = filtered
    ? buildScopeTarget({ scopeKeys, targetMap, authority, metric: "cash" })
    : {
        value: authority?.cashCoverageTrusted === true ? authority.cashTargetTotal : null,
        status: authority?.cashCoverageTrusted === true ? (Number(authority.cashTargetTotal) === 0 ? KPI_VALUE_STATUS.VALID_ZERO : KPI_VALUE_STATUS.VALID) : SUMMARY_KPI_STATUS.TARGET_INCOMPLETE,
        configuredStoreCount: authority?.cashConfiguredStoreCount || 0,
        eligibleStoreCount: authority?.eligibleStoreCount || 0,
        missingStoreKeys: authority?.cashMissingStoreKeys || [],
        coverageComplete: authority?.cashCoverageTrusted === true,
      };
  const accrualTarget = filtered
    ? buildScopeTarget({ scopeKeys, targetMap, authority, metric: "accrual" })
    : {
        value: authority?.accrualCoverageTrusted === true ? authority.accrualTargetTotal : null,
        status: authority?.accrualCoverageTrusted === true ? (Number(authority.accrualTargetTotal) === 0 ? KPI_VALUE_STATUS.VALID_ZERO : KPI_VALUE_STATUS.VALID) : SUMMARY_KPI_STATUS.TARGET_INCOMPLETE,
        configuredStoreCount: authority?.accrualConfiguredStoreCount || 0,
        eligibleStoreCount: authority?.eligibleStoreCount || 0,
        missingStoreKeys: authority?.accrualMissingStoreKeys || [],
        coverageComplete: authority?.accrualCoverageTrusted === true,
      };

  const cashAchievement = buildScopeFormalAchievement({
    actualValue: cashActual.value,
    actualStatus: cashActual.status,
    targetValue: cashTarget.value,
    coverageComplete: cashTarget.coverageComplete,
  });
  const accrualAchievement = buildScopeFormalAchievement({
    actualValue: accrualActual.value,
    actualStatus: accrualActual.status,
    targetValue: accrualTarget.value,
    coverageComplete: accrualTarget.coverageComplete,
  });

  return {
    compatible: true,
    targetSummaryAvailable,
    targetAuthority: authority,
    lifecycleReady: authority?.lifecycleReady === true,
    scopeEligibleStoreCount: scopeKeys.length,
    scopeStoreKeys: scopeKeys,
    cash: cashActual.value,
    cashStatus: cashActual.status,
    cashTarget: cashTarget.value,
    cashTargetStatus: cashTarget.status,
    cashAchievement: cashAchievement.value,
    cashAchievementStatus: cashAchievement.status,
    accrual: accrualActual.value,
    accrualStatus: accrualActual.status,
    accrualTarget: accrualTarget.value,
    accrualTargetStatus: accrualTarget.status,
    accrualAchievement: accrualAchievement.value,
    accrualAchievementStatus: accrualAchievement.status,
    cashCoverageComplete: cashTarget.coverageComplete,
    accrualCoverageComplete: accrualTarget.coverageComplete,
    cashMissingStoreKeys: cashTarget.missingStoreKeys,
    accrualMissingStoreKeys: accrualTarget.missingStoreKeys,
  };
};

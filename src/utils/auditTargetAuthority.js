import {
  KPI_VALUE_STATUS,
  validBaseTarget,
} from "./kpiContracts.js";
import { TARGET_AUTHORITY_CONFLICT_STATUS } from "./targetAuthorityConflict.js";

export const AUDIT_TARGET_AUTHORITY_STATUS = Object.freeze({
  CONFIGURED: "CONFIGURED",
  TARGET_NOT_SET: KPI_VALUE_STATUS.TARGET_NOT_SET,
  DATA_INVALID: KPI_VALUE_STATUS.DATA_INVALID,
  AUTHORITY_CONFLICT: TARGET_AUTHORITY_CONFLICT_STATUS,
  AUTHORITY_NOT_READY: "AUTHORITY_NOT_READY",
});

const normalizeBrandId = (value = "") => {
  const text = String(value || "").trim().toLowerCase();
  if (["cyj", "default", "default-app-id", "drcyj"].includes(text)) return "cyj";
  if (["anniu", "anew", "安妞"].includes(text)) return "anniu";
  if (["yibo", "伊啵"].includes(text)) return "yibo";
  return "";
};

const normalizeYearMonth = (value = "") => {
  const text = String(value || "").trim();
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(text) ? text : "";
};

const isAuthorityConflict = (row = {}) => (
  row?.authorityConflict === true ||
  String(row?.authorityStatus || "") === TARGET_AUTHORITY_CONFLICT_STATUS ||
  String(row?.status || "") === TARGET_AUTHORITY_CONFLICT_STATUS
);

const resolveMetric = (row = {}, fieldName = "", declaredMissing = false) => {
  if (declaredMissing) {
    return {
      configured: false,
      value: null,
      status: KPI_VALUE_STATUS.TARGET_NOT_SET,
    };
  }

  const result = validBaseTarget(row?.[fieldName]);
  return {
    configured: result.valid === true,
    value: result.valid === true ? result.value : null,
    status: result.status,
  };
};

export const buildAuditTargetSummaryAuthority = ({
  summary = null,
  brandId = "",
  yearMonth = "",
  normalizeStoreKey = (value) => String(value || "").trim(),
} = {}) => {
  const expectedBrandId = normalizeBrandId(brandId);
  const expectedYearMonth = normalizeYearMonth(yearMonth);
  const summaryBrandId = normalizeBrandId(summary?.brandId || "");
  const summaryYearMonth = normalizeYearMonth(summary?.yearMonth || summary?.id || "");

  const compatible = Boolean(
    summary &&
    expectedBrandId &&
    expectedYearMonth &&
    summaryBrandId === expectedBrandId &&
    summaryYearMonth === expectedYearMonth &&
    String(summary?.targetCoverageVersion || "") === "target-coverage-v1" &&
    summary?.lifecycleReady === true &&
    Array.isArray(summary?.cashMissingStores) &&
    Array.isArray(summary?.accrualMissingStores)
  );

  if (!compatible) {
    return {
      compatible: false,
      brandId: expectedBrandId,
      yearMonth: expectedYearMonth,
      targetsByStore: new Map(),
      cashMissingStoreKeys: new Set(),
      accrualMissingStoreKeys: new Set(),
    };
  }

  const targetsByStore = new Map();
  const canonicalTargets = summary?.targets && typeof summary.targets === "object"
    ? summary.targets
    : {};

  Object.entries(canonicalTargets).forEach(([key, row]) => {
    if (!row || typeof row !== "object") return;
    const storeKey = normalizeStoreKey(row?.storeName || key);
    if (storeKey) targetsByStore.set(storeKey, row);
  });

  return {
    compatible: true,
    brandId: expectedBrandId,
    yearMonth: expectedYearMonth,
    targetsByStore,
    cashMissingStoreKeys: new Set(
      summary.cashMissingStores.map((name) => normalizeStoreKey(name)).filter(Boolean)
    ),
    accrualMissingStoreKeys: new Set(
      summary.accrualMissingStores.map((name) => normalizeStoreKey(name)).filter(Boolean)
    ),
  };
};

export const resolveAuditStoreTargetPresence = ({
  authority = null,
  storeName = "",
  normalizeStoreKey = (value) => String(value || "").trim(),
} = {}) => {
  if (authority?.compatible !== true) {
    return {
      configured: false,
      status: AUDIT_TARGET_AUTHORITY_STATUS.AUTHORITY_NOT_READY,
      cash: null,
      accrual: null,
    };
  }

  const storeKey = normalizeStoreKey(storeName);
  if (!storeKey) {
    return {
      configured: false,
      status: AUDIT_TARGET_AUTHORITY_STATUS.TARGET_NOT_SET,
      cash: null,
      accrual: null,
    };
  }

  const row = authority.targetsByStore?.get(storeKey) || {};
  if (isAuthorityConflict(row)) {
    return {
      configured: false,
      status: AUDIT_TARGET_AUTHORITY_STATUS.AUTHORITY_CONFLICT,
      cash: null,
      accrual: null,
    };
  }

  const cash = resolveMetric(
    row,
    "cashTarget",
    authority.cashMissingStoreKeys?.has(storeKey) === true
  );
  const accrual = resolveMetric(
    row,
    "accrualTarget",
    authority.accrualMissingStoreKeys?.has(storeKey) === true
  );

  const configured = cash.configured === true || accrual.configured === true;
  if (configured) {
    return {
      configured: true,
      status: AUDIT_TARGET_AUTHORITY_STATUS.CONFIGURED,
      cash,
      accrual,
    };
  }

  const hasInvalid = cash.status === KPI_VALUE_STATUS.DATA_INVALID ||
    accrual.status === KPI_VALUE_STATUS.DATA_INVALID;

  return {
    configured: false,
    status: hasInvalid
      ? AUDIT_TARGET_AUTHORITY_STATUS.DATA_INVALID
      : AUDIT_TARGET_AUTHORITY_STATUS.TARGET_NOT_SET,
    cash,
    accrual,
  };
};

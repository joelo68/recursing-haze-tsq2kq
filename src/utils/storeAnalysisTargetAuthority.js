export const STORE_ANALYSIS_TARGET_PRESENTATION_VERSION = "store-analysis-target-presentation-v1";

export const STORE_ANALYSIS_TARGET_STATUS = Object.freeze({
  VALID: "VALID",
  TARGET_NOT_SET: "TARGET_NOT_SET",
  TARGET_INCOMPLETE: "TARGET_INCOMPLETE",
  TARGET_INVALID: "TARGET_INVALID",
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

const readCashTarget = (row = {}) => {
  if (!row || typeof row !== "object" || !Object.prototype.hasOwnProperty.call(row, "cashTarget")) {
    return { found: false, value: null, configured: false, status: STORE_ANALYSIS_TARGET_STATUS.TARGET_INCOMPLETE };
  }

  const raw = row.cashTarget;
  if (raw === null || raw === undefined || raw === "") {
    return { found: false, value: null, configured: false, status: STORE_ANALYSIS_TARGET_STATUS.TARGET_INCOMPLETE };
  }

  const value = Number(raw);
  if (!Number.isFinite(value)) {
    return { found: false, value: null, configured: false, status: STORE_ANALYSIS_TARGET_STATUS.TARGET_INVALID };
  }
  if (value === 0) {
    return { found: true, value: 0, configured: false, status: STORE_ANALYSIS_TARGET_STATUS.TARGET_NOT_SET };
  }
  if (value < 0) {
    return { found: false, value: null, configured: false, status: STORE_ANALYSIS_TARGET_STATUS.TARGET_INVALID };
  }

  return { found: true, value, configured: true, status: STORE_ANALYSIS_TARGET_STATUS.VALID };
};

export const buildStoreAnalysisTargetPresentationAuthority = ({
  summary = null,
  brandId = "",
  yearMonth = "",
  normalizeStoreKey = (value) => String(value || "").trim(),
} = {}) => {
  const expectedBrandId = normalizeBrandId(brandId);
  const expectedYearMonth = normalizeYearMonth(yearMonth);
  const summaryBrandId = normalizeBrandId(summary?.brandId || "");
  const summaryYearMonth = normalizeYearMonth(summary?.yearMonth || summary?.id || "");
  const coverageCompatible = Boolean(
    summary &&
    expectedBrandId &&
    expectedYearMonth &&
    summaryBrandId === expectedBrandId &&
    summaryYearMonth === expectedYearMonth &&
    String(summary?.targetCoverageVersion || "") === "target-coverage-v1" &&
    summary?.lifecycleReady === true &&
    Array.isArray(summary?.cashMissingStores)
  );

  if (!coverageCompatible) {
    return {
      version: STORE_ANALYSIS_TARGET_PRESENTATION_VERSION,
      compatible: false,
      brandId: expectedBrandId,
      yearMonth: expectedYearMonth,
      targetsByStore: new Map(),
      cashMissingStoreKeys: new Set(),
    };
  }

  const cashMissingStoreKeys = new Set(
    summary.cashMissingStores.map((name) => normalizeStoreKey(name)).filter(Boolean)
  );
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
    version: STORE_ANALYSIS_TARGET_PRESENTATION_VERSION,
    compatible: true,
    brandId: expectedBrandId,
    yearMonth: expectedYearMonth,
    targetsByStore,
    cashMissingStoreKeys,
  };
};

export const resolveStoreAnalysisCashTargetPresentation = ({
  authority = null,
  storeName = "",
  normalizeStoreKey = (value) => String(value || "").trim(),
} = {}) => {
  if (authority?.compatible !== true) {
    return { found: false, value: null, configured: false, status: STORE_ANALYSIS_TARGET_STATUS.AUTHORITY_NOT_READY };
  }

  const storeKey = normalizeStoreKey(storeName);
  if (!storeKey) {
    return { found: false, value: null, configured: false, status: STORE_ANALYSIS_TARGET_STATUS.TARGET_INCOMPLETE };
  }

  // Coverage metadata is the status authority. Once the store is declared missing,
  // no legacy/stale target container is allowed to resurrect an old denominator.
  if (authority.cashMissingStoreKeys?.has(storeKey)) {
    return { found: true, value: 0, configured: false, status: STORE_ANALYSIS_TARGET_STATUS.TARGET_NOT_SET };
  }

  return readCashTarget(authority.targetsByStore?.get(storeKey) || {});
};

export const resolveStoreAnalysisCashTargetScopePresentation = ({
  authority = null,
  storeNames = [],
  normalizeStoreKey = (value) => String(value || "").trim(),
} = {}) => {
  const storeKeys = Array.from(new Set((storeNames || []).map((name) => normalizeStoreKey(name)).filter(Boolean)));
  if (storeKeys.length === 0 || authority?.compatible !== true) {
    return { complete: false, value: null, status: STORE_ANALYSIS_TARGET_STATUS.TARGET_INCOMPLETE };
  }

  let total = 0;
  for (const storeKey of storeKeys) {
    const result = resolveStoreAnalysisCashTargetPresentation({ authority, storeName: storeKey, normalizeStoreKey });
    if (result.configured !== true || result.status !== STORE_ANALYSIS_TARGET_STATUS.VALID) {
      return { complete: false, value: null, status: result.status };
    }
    total += result.value;
  }

  return { complete: true, value: total, status: STORE_ANALYSIS_TARGET_STATUS.VALID };
};

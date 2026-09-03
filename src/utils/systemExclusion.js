export const SYSTEM_EXCLUSION_VERSION = "system-exclusion-v1";

export const normalizeSystemExclusionStoreKey = (value = "") => {
  let core = String(value || "")
    .trim()
    .replace(/[　\s]+/g, "")
    .replace(/[（）()]/g, "")
    .replace(/臺/g, "台")
    .replace(/^DR\.?CYJ/i, "CYJ")
    .replace(/^(CYJ|Anew安妞|Yibo伊啵|Anew|Yibo|Ann|安妞|伊啵)/i, "")
    .trim();
  if (!core) return "";
  if (core === "新" || /^新店店?$/.test(core)) return "新店";
  return core.replace(/店+$/g, "").trim();
};


export const getSystemExcludedStoreSet = (state = {}, normalizeStoreKey = normalizeSystemExclusionStoreKey) => {
  if (!state || state.ready !== true) return new Set();
  return new Set(
    (state.stores || [])
      .map((store) => normalizeStoreKey(store))
      .filter(Boolean)
  );
};

export const filterSystemExcludedStoreKeys = (values = [], state = {}, normalizeStoreKey = normalizeSystemExclusionStoreKey) => {
  const excluded = getSystemExcludedStoreSet(state, normalizeStoreKey);
  return [...new Set(
    (Array.isArray(values) ? values : [])
      .map((store) => normalizeStoreKey(store))
      .filter((storeKey) => storeKey && !excluded.has(storeKey))
  )];
};

export const normalizeSystemExclusionRevision = (value) => {
  const revision = Number(value);
  return Number.isInteger(revision) && revision >= 0 ? revision : 0;
};

export const normalizeSystemExclusionState = (data = {}, brandId = "", options = {}) => {
  const raw = data && typeof data === "object" ? data : {};
  const stores = [...new Set(
    (Array.isArray(raw.stores) ? raw.stores : (Array.isArray(raw.excludedStores) ? raw.excludedStores : []))
      .map(normalizeSystemExclusionStoreKey)
      .filter(Boolean)
  )].sort((a, b) => a.localeCompare(b, "zh-Hant"));
  const normalizedBrandId = String(brandId || raw.brandId || "").trim().toLowerCase();
  const version = String(raw.systemExclusionVersion || raw.version || "");
  const revision = normalizeSystemExclusionRevision(raw.revision);
  return {
    ready: options.ready !== false,
    brandId: normalizedBrandId,
    version: version || SYSTEM_EXCLUSION_VERSION,
    revision,
    stores,
    storeSet: new Set(stores),
    legacy: !version && revision === 0,
    updatedAtText: String(raw.updatedAtText || ""),
    updatedBy: String(raw.updatedBy || ""),
  };
};

export const buildSystemExclusionSnapshot = (state = {}, brandId = "") => ({
  version: SYSTEM_EXCLUSION_VERSION,
  brandId: String(brandId || state.brandId || "").trim().toLowerCase(),
  revision: normalizeSystemExclusionRevision(state.revision),
  stores: [...new Set((state.stores || []).map(normalizeSystemExclusionStoreKey).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "zh-Hant")),
});

export const isSystemExclusionSnapshotCurrent = ({ snapshot = null, currentState = null, brandId = "" } = {}) => {
  if (!currentState || currentState.ready !== true) return false;
  const expectedBrandId = String(brandId || currentState.brandId || "").trim().toLowerCase();
  const expectedRevision = normalizeSystemExclusionRevision(currentState.revision);
  const expectedStores = [...new Set((currentState.stores || []).map(normalizeSystemExclusionStoreKey).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "zh-Hant"));

  // Safe legacy compatibility: when no store is excluded and revision is still 0,
  // old Coverage documents without a System Exclusion snapshot have the same denominator.
  if (!snapshot || typeof snapshot !== "object") {
    return expectedRevision === 0 && expectedStores.length === 0;
  }

  const actualStores = [...new Set((snapshot.stores || []).map(normalizeSystemExclusionStoreKey).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "zh-Hant"));
  return (
    String(snapshot.version || snapshot.systemExclusionVersion || "") === SYSTEM_EXCLUSION_VERSION &&
    String(snapshot.brandId || "").trim().toLowerCase() === expectedBrandId &&
    normalizeSystemExclusionRevision(snapshot.revision) === expectedRevision &&
    JSON.stringify(actualStores) === JSON.stringify(expectedStores)
  );
};

export const inspectHistoricalSystemExclusionTrust = ({
  currentState = null,
  brandId = "",
  summaries = [],
  summaryFlag = null,
} = {}) => {
  const expectedBrandId = String(brandId || currentState?.brandId || "").trim().toLowerCase();
  if (!currentState || currentState.ready !== true) {
    return { trusted: false, reason: "SYSTEM_EXCLUSION_NOT_READY" };
  }
  if (!expectedBrandId || String(currentState.brandId || "").trim().toLowerCase() !== expectedBrandId) {
    return { trusted: false, reason: "SYSTEM_EXCLUSION_BRAND_MISMATCH" };
  }

  const documents = (Array.isArray(summaries) ? summaries : []).filter(Boolean);
  for (const summary of documents) {
    if (!isSystemExclusionSnapshotCurrent({
      snapshot: summary?.systemExclusionSnapshot || null,
      currentState,
      brandId: expectedBrandId,
    })) {
      return { trusted: false, reason: "SYSTEM_EXCLUSION_SUMMARY_REVISION_MISMATCH" };
    }
  }

  if (summaryFlag && !isSystemExclusionSnapshotCurrent({
    snapshot: summaryFlag?.systemExclusionSnapshot || null,
    currentState,
    brandId: expectedBrandId,
  })) {
    return { trusted: false, reason: "SYSTEM_EXCLUSION_FLAG_REVISION_MISMATCH" };
  }

  return { trusted: true, reason: "SYSTEM_EXCLUSION_REVISION_CURRENT" };
};

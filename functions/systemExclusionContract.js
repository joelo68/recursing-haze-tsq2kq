const SYSTEM_EXCLUSION_VERSION = 'system-exclusion-v1';

function normalizeSystemExclusionRevision(value) {
  const revision = Number(value);
  return Number.isInteger(revision) && revision >= 0 ? revision : 0;
}

function normalizeStoredSystemExclusionProfile(data = {}, brandId = '', normalizeStoreKey = (value) => String(value || '').trim()) {
  const source = data && typeof data === 'object' ? data : {};
  const rawStores = Array.isArray(source.stores)
    ? source.stores
    : (Array.isArray(source.excludedStores) ? source.excludedStores : []);
  const stores = [...new Set(rawStores.map(normalizeStoreKey).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'zh-Hant'));
  return {
    version: String(source.systemExclusionVersion || source.version || SYSTEM_EXCLUSION_VERSION),
    brandId: String(brandId || source.brandId || '').trim().toLowerCase(),
    revision: normalizeSystemExclusionRevision(source.revision),
    stores,
    storeSet: new Set(stores),
    legacy: !source.systemExclusionVersion && !source.version && normalizeSystemExclusionRevision(source.revision) === 0,
    updatedAtText: String(source.updatedAtText || ''),
    updatedBy: String(source.updatedBy || ''),
  };
}

function buildStoredSystemExclusionSnapshot(profile = {}, brandId = '', normalizeStoreKey = (value) => String(value || '').trim()) {
  const stores = [...new Set((profile.stores || []).map(normalizeStoreKey).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'zh-Hant'));
  return {
    version: SYSTEM_EXCLUSION_VERSION,
    brandId: String(brandId || profile.brandId || '').trim().toLowerCase(),
    revision: normalizeSystemExclusionRevision(profile.revision),
    stores,
  };
}

function isStoredSystemExclusionSnapshotCurrent({
  snapshot = null,
  currentProfile = {},
  brandId = '',
  normalizeStoreKey = (value) => String(value || '').trim(),
} = {}) {
  const current = normalizeStoredSystemExclusionProfile(currentProfile, brandId, normalizeStoreKey);
  if (!snapshot || typeof snapshot !== 'object') {
    return current.revision === 0 && current.stores.length === 0;
  }

  const actual = buildStoredSystemExclusionSnapshot(snapshot, brandId, normalizeStoreKey);
  return (
    String(snapshot.version || snapshot.systemExclusionVersion || '') === SYSTEM_EXCLUSION_VERSION &&
    actual.brandId === current.brandId &&
    actual.revision === current.revision &&
    JSON.stringify(actual.stores) === JSON.stringify(current.stores)
  );
}

module.exports = {
  SYSTEM_EXCLUSION_VERSION,
  normalizeSystemExclusionRevision,
  normalizeStoredSystemExclusionProfile,
  buildStoredSystemExclusionSnapshot,
  isStoredSystemExclusionSnapshotCurrent,
};

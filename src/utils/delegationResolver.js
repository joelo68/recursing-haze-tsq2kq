// src/utils/delegationResolver.js
// 期間式代理與托管的單一判斷來源。
// 正式組織歸屬仍由 org_structure / store_account_data 保存；本檔只計算額外可管理範圍。

export const DELEGATION_SCHEMA_VERSION = "delegation-v1";

export const DEFAULT_DELEGATION_PERMISSIONS = Object.freeze({
  viewOperations: true,
  editReports: true,
  editHistory: true,
  deleteReports: false,
  receiveAlerts: true,
  manageTasks: true,
  editTargets: false,
  editOrganization: false,
});

export const DELEGATION_PERMISSION_LABELS = Object.freeze({
  viewOperations: "查看營運數據",
  editReports: "填寫或更新日報",
  editHistory: "修正歷史日報",
  deleteReports: "刪除歷史日報",
  receiveAlerts: "接收缺報與異常提醒",
  manageTasks: "處理改善任務",
  editTargets: "調整年度目標",
  editOrganization: "修改正式組織架構",
});

export const normalizeDelegationStoreCore = (value = "") => {
  let core = String(value || "")
    .trim()
    .replace(/[　\s]+/g, "")
    .replace(/[（）()]/g, "")
    .replace(/臺/g, "台")
    .replace(/^DR\.?(?:CYJ)?/i, "CYJ")
    .replace(/^(CYJ|Anew安妞|Yibo伊啵|Anew|Yibo|Ann|安妞|伊啵)/i, "")
    .trim();

  if (!core) return "";
  if (core === "新" || /^新店店?$/.test(core)) return "新店";
  return core.replace(/店+$/g, "").trim();
};

export const getLocalDateString = (date = new Date()) => {
  const value = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(value.getTime())) return "";
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const normalizeDateString = (value = "") => {
  if (!value) return "";
  if (typeof value?.toDate === "function") return getLocalDateString(value.toDate());
  if (value instanceof Date) return getLocalDateString(value);
  const text = String(value || "").trim().replace(/\//g, "-");
  const match = text.match(/(20\d{2})-(\d{1,2})-(\d{1,2})/);
  if (!match) return "";
  return `${match[1]}-${String(match[2]).padStart(2, "0")}-${String(match[3]).padStart(2, "0")}`;
};

const normalizeTextKey = (value = "") => String(value || "")
  .trim()
  .toLocaleLowerCase("zh-Hant")
  .replace(/[　\s\-_/()（）.]/g, "");

export const getDelegationAccountKey = (role = "", account = {}) => {
  const normalizedRole = String(role || account?.role || "").trim().toLowerCase();
  const id = String(account?.id || account?.accountId || account?.uid || "").trim();
  const name = String(account?.name || account?.displayName || "").trim();
  return `${normalizedRole}:${normalizeTextKey(id || name)}`;
};

export const normalizeDelegationPermissions = (permissions = {}) => ({
  ...DEFAULT_DELEGATION_PERMISSIONS,
  ...(permissions || {}),
  // 暫代身分永遠不能直接變更正式組織架構。
  editOrganization: false,
});

export const normalizeDelegation = (raw = {}, id = "") => {
  const storeNames = Array.isArray(raw.storeNames)
    ? raw.storeNames
    : (Array.isArray(raw.stores) ? raw.stores : []);
  const normalizedStores = [...new Set(storeNames.map(normalizeDelegationStoreCore).filter(Boolean))];
  const principalRole = String(raw.principalRole || raw.ownerRole || raw.sourceRole || "manager").trim().toLowerCase();
  const delegateRole = String(raw.delegateRole || raw.proxyRole || raw.targetRole || principalRole).trim().toLowerCase();
  const principalId = String(raw.principalId || raw.ownerId || "").trim();
  const delegateId = String(raw.delegateId || raw.proxyId || "").trim();
  const principalName = String(raw.principalName || raw.ownerName || "").trim();
  const delegateName = String(raw.delegateName || raw.proxyName || "").trim();

  return {
    ...raw,
    id: String(id || raw.id || "").trim(),
    schemaVersion: raw.schemaVersion || DELEGATION_SCHEMA_VERSION,
    type: raw.type === "store_manager" ? "store_manager" : "regional_manager",
    principalRole,
    principalId,
    principalName,
    delegateRole,
    delegateId,
    delegateName,
    scopeMode: raw.scopeMode === "selected_stores" ? "selected_stores" : "all_assigned_stores",
    storeNames: normalizedStores,
    principalStoreSnapshot: [...new Set((Array.isArray(raw.principalStoreSnapshot) ? raw.principalStoreSnapshot : []).map(normalizeDelegationStoreCore).filter(Boolean))],
    startDate: normalizeDateString(raw.startDate),
    endDate: normalizeDateString(raw.endDate),
    status: String(raw.status || "active").trim().toLowerCase(),
    permissions: normalizeDelegationPermissions(raw.permissions || {}),
    reason: String(raw.reason || "").trim(),
    endedAtText: String(raw.endedAtText || ""),
    endedEarly: raw.endedEarly === true,
    createdAtText: String(raw.createdAtText || ""),
    updatedAtText: String(raw.updatedAtText || ""),
  };
};

export const isDelegationActive = (delegation = {}, date = getLocalDateString()) => {
  const item = normalizeDelegation(delegation, delegation?.id);
  const targetDate = normalizeDateString(date) || getLocalDateString();
  if (!["active", "scheduled"].includes(item.status)) return false;
  if (!item.startDate || !item.endDate || !targetDate) return false;
  if (item.endedAtText || item.endedEarly === true) return false;
  return item.startDate <= targetDate && targetDate <= item.endDate;
};

export const getDelegationStatus = (delegation = {}, date = getLocalDateString()) => {
  const item = normalizeDelegation(delegation, delegation?.id);
  const targetDate = normalizeDateString(date) || getLocalDateString();
  if (["ended", "cancelled", "inactive"].includes(item.status) || item.endedAtText || item.endedEarly === true) return "ended";
  if (!item.startDate || !item.endDate) return "invalid";
  if (targetDate < item.startDate) return "scheduled";
  if (targetDate > item.endDate) return "expired";
  return "active";
};

const accountMatches = (role, account = {}, id = "", name = "") => {
  const targetRole = String(role || "").trim().toLowerCase();
  const accountRole = String(account?.role || targetRole || "").trim().toLowerCase();
  if (targetRole && accountRole && targetRole !== accountRole) return false;

  const candidateIds = [account?.id, account?.accountId, account?.uid].map(normalizeTextKey).filter(Boolean);
  const candidateNames = [account?.name, account?.displayName].map(normalizeTextKey).filter(Boolean);
  const targetId = normalizeTextKey(id);
  const targetName = normalizeTextKey(name);
  if (targetId && candidateIds.includes(targetId)) return true;
  if (targetName && candidateNames.includes(targetName)) return true;
  return false;
};

export const delegationAppliesToUser = (delegation = {}, role = "", user = {}, side = "delegate") => {
  const item = normalizeDelegation(delegation, delegation?.id);
  if (side === "principal") {
    return accountMatches(item.principalRole, { ...user, role }, item.principalId, item.principalName);
  }
  return accountMatches(item.delegateRole, { ...user, role }, item.delegateId, item.delegateName);
};

const findStoreAccount = (storeAccounts = [], id = "", name = "") => (
  (storeAccounts || []).find((account) => accountMatches("store", { ...account, role: "store" }, id, name)) || null
);

export const resolveDelegationStores = (delegation = {}, managers = {}, storeAccounts = []) => {
  const item = normalizeDelegation(delegation, delegation?.id);
  if (item.scopeMode === "selected_stores" && item.storeNames.length > 0) return item.storeNames;

  let sourceStores = [];
  if (item.principalRole === "manager" || item.type === "regional_manager") {
    const matchedManager = Object.keys(managers || {}).find(
      (name) => normalizeTextKey(name) === normalizeTextKey(item.principalName)
    );
    sourceStores = matchedManager ? managers?.[matchedManager] : [];
  } else if (item.principalRole === "store" || item.type === "store_manager") {
    const account = findStoreAccount(storeAccounts, item.principalId, item.principalName);
    sourceStores = account?.stores || (account?.storeName ? [account.storeName] : []);
  }

  if ((!sourceStores || sourceStores.length === 0) && Array.isArray(item.principalStoreSnapshot)) {
    sourceStores = item.principalStoreSnapshot;
  }

  return [...new Set((sourceStores || []).map(normalizeDelegationStoreCore).filter(Boolean))];
};

export const resolveActiveDelegations = (delegations = [], date = getLocalDateString()) => (
  (delegations || [])
    .map((item) => normalizeDelegation(item, item?.id))
    .filter((item) => isDelegationActive(item, date))
    .sort((a, b) => String(a.endDate).localeCompare(String(b.endDate)) || String(a.createdAtText || "").localeCompare(String(b.createdAtText || "")) )
);

const getOfficialStoresForUser = ({ role = "", user = {}, managers = {}, storeAccounts = [] } = {}) => {
  const normalizedRole = String(role || "").trim().toLowerCase();
  if (["director", "master", "trainer"].includes(normalizedRole)) {
    return [...new Set(Object.values(managers || {}).flat().map(normalizeDelegationStoreCore).filter(Boolean))];
  }
  if (normalizedRole === "manager") {
    const managerName = Object.keys(managers || {}).find((name) => normalizeTextKey(name) === normalizeTextKey(user?.name));
    return [...new Set((managerName ? managers[managerName] : []).map(normalizeDelegationStoreCore).filter(Boolean))];
  }
  if (normalizedRole === "store") {
    const account = findStoreAccount(storeAccounts, user?.id || user?.accountId, user?.name) || user;
    const stores = account?.stores || (account?.storeName ? [account.storeName] : []);
    return [...new Set((stores || []).map(normalizeDelegationStoreCore).filter(Boolean))];
  }
  if (normalizedRole === "therapist") {
    const store = user?.store || user?.storeName || user?.primaryStore || (Array.isArray(user?.stores) ? user.stores[0] : "");
    return [normalizeDelegationStoreCore(store)].filter(Boolean);
  }
  return [];
};

export const buildDelegationAccessProfile = ({
  role = "",
  user = {},
  managers = {},
  storeAccounts = [],
  delegations = [],
  date = getLocalDateString(),
} = {}) => {
  const normalizedRole = String(role || "").trim().toLowerCase();
  const officialStores = getOfficialStoresForUser({ role: normalizedRole, user, managers, storeAccounts });
  const officialStoreSet = new Set(officialStores);
  const activeDelegations = resolveActiveDelegations(delegations, date);
  const delegatedRecords = activeDelegations.filter((item) => delegationAppliesToUser(item, normalizedRole, user, "delegate"));
  const principalRecords = activeDelegations.filter((item) => delegationAppliesToUser(item, normalizedRole, user, "principal"));
  const storePermissions = {};
  const storeDelegations = {};

  delegatedRecords.forEach((item) => {
    resolveDelegationStores(item, managers, storeAccounts).forEach((storeCore) => {
      storePermissions[storeCore] = Object.keys(DEFAULT_DELEGATION_PERMISSIONS).reduce((acc, key) => {
        acc[key] = Boolean(acc[key] || item.permissions?.[key]);
        return acc;
      }, { ...(storePermissions[storeCore] || {}) });
      if (!storeDelegations[storeCore]) storeDelegations[storeCore] = [];
      storeDelegations[storeCore].push(item);
    });
  });

  const hasInteractiveStoreAccess = (permissions = {}) => Boolean(
    permissions.viewOperations ||
    permissions.editReports ||
    permissions.editHistory ||
    permissions.deleteReports ||
    permissions.editTargets
  );
  const delegatedStores = Object.keys(storePermissions).filter(
    (store) => !officialStoreSet.has(store) && hasInteractiveStoreAccess(storePermissions[store])
  );
  const accessibleStores = [...new Set([...officialStores, ...delegatedStores])];

  return {
    date: normalizeDateString(date) || getLocalDateString(),
    role: normalizedRole,
    user,
    isGlobalRole: ["director", "master", "trainer"].includes(normalizedRole),
    officialStores,
    delegatedStores,
    accessibleStores,
    officialStoreSet,
    accessibleStoreSet: new Set(accessibleStores),
    storePermissions,
    storeDelegations,
    activeAsDelegate: delegatedRecords,
    activeAsPrincipal: principalRecords,
  };
};

export const canAccessStore = (profile = {}, storeName = "") => {
  const core = normalizeDelegationStoreCore(storeName);
  if (!core) return false;
  if (profile?.isGlobalRole) return true;
  const set = profile?.accessibleStoreSet instanceof Set
    ? profile.accessibleStoreSet
    : new Set(profile?.accessibleStores || []);
  return set.has(core);
};

export const canPerformDelegatedStoreAction = (profile = {}, storeName = "", permissionKey = "viewOperations") => {
  const core = normalizeDelegationStoreCore(storeName);
  if (!core) return false;
  if (profile?.isGlobalRole) return true;

  const officialSet = profile?.officialStoreSet instanceof Set
    ? profile.officialStoreSet
    : new Set(profile?.officialStores || []);
  if (officialSet.has(core)) return true;
  return Boolean(profile?.storePermissions?.[core]?.[permissionKey]);
};

export const getDelegationForStore = ({
  delegations = [],
  storeName = "",
  managers = {},
  storeAccounts = [],
  date = getLocalDateString(),
  permissionKey = "",
} = {}) => {
  const core = normalizeDelegationStoreCore(storeName);
  if (!core) return null;
  return resolveActiveDelegations(delegations, date).find((item) => {
    if (permissionKey && !item.permissions?.[permissionKey]) return false;
    return resolveDelegationStores(item, managers, storeAccounts).includes(core);
  }) || null;
};

const rangesOverlap = (aStart, aEnd, bStart, bEnd) => (
  Boolean(aStart && aEnd && bStart && bEnd) && aStart <= bEnd && bStart <= aEnd
);

export const validateDelegationConflict = ({
  candidate,
  existingDelegations = [],
  managers = {},
  storeAccounts = [],
} = {}) => {
  const item = normalizeDelegation(candidate || {}, candidate?.id);
  if (!item.principalName && !item.principalId) return { valid: false, error: "請選擇原主管", conflicts: [] };
  if (!item.delegateName && !item.delegateId) return { valid: false, error: "請選擇代理人", conflicts: [] };
  if (!item.startDate || !item.endDate) return { valid: false, error: "請設定代理開始與結束日期", conflicts: [] };
  if (item.endDate < item.startDate) return { valid: false, error: "結束日期不可早於開始日期", conflicts: [] };
  if (item.scopeMode === "selected_stores" && item.storeNames.length === 0) return { valid: false, error: "指定店家代理至少要選擇一間店", conflicts: [] };
  if (
    normalizeTextKey(item.principalId || item.principalName) === normalizeTextKey(item.delegateId || item.delegateName) &&
    item.principalRole === item.delegateRole
  ) {
    return { valid: false, error: "原主管與代理人不可為同一人", conflicts: [] };
  }

  const candidateStores = new Set(resolveDelegationStores(item, managers, storeAccounts));
  if (candidateStores.size === 0) return { valid: false, error: "原主管目前沒有可交付的店家", conflicts: [] };

  const conflicts = (existingDelegations || [])
    .map((row) => normalizeDelegation(row, row?.id))
    .filter((row) => row.id !== item.id)
    .filter((row) => !["ended", "cancelled", "inactive"].includes(row.status) && !row.endedAtText)
    .filter((row) => rangesOverlap(item.startDate, item.endDate, row.startDate, row.endDate))
    .filter((row) => {
      const rowStores = resolveDelegationStores(row, managers, storeAccounts);
      return rowStores.some((store) => candidateStores.has(store));
    });

  if (conflicts.length > 0) {
    const first = conflicts[0];
    const overlapStores = resolveDelegationStores(first, managers, storeAccounts).filter((store) => candidateStores.has(store));
    return {
      valid: false,
      error: `代理期間與既有安排重疊：${overlapStores.slice(0, 4).join("、")}${overlapStores.length > 4 ? "…" : ""}`,
      conflicts,
    };
  }

  return { valid: true, error: "", conflicts: [] };
};

export const describeDelegationScope = (delegation = {}, managers = {}, storeAccounts = []) => {
  const item = normalizeDelegation(delegation, delegation?.id);
  const stores = resolveDelegationStores(item, managers, storeAccounts);
  if (item.scopeMode === "all_assigned_stores") return `全部轄區（${stores.length} 間）`;
  return `指定店家（${stores.length} 間）`;
};

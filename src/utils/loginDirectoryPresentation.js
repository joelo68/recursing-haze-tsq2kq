import { normalizeStoreCoreName } from "./helpers.js";

export const STORE_LOGIN_UNASSIGNED_REGION = "__store_login_unassigned__";

const toStoreCoreSet = (values = []) => new Set(
  (Array.isArray(values) ? values : [values])
    .map((value) => normalizeStoreCoreName(value))
    .filter(Boolean)
);

export const getStoreAccountStoreCores = (account = {}) => {
  const rawStores = Array.isArray(account?.stores) && account.stores.length
    ? account.stores
    : [account?.storeName || account?.store || ""];
  return [...toStoreCoreSet(rawStores)];
};

export const storeAccountBelongsToManager = (account = {}, managerName = "", managers = {}) => {
  const managerStores = toStoreCoreSet(managers?.[managerName] || []);
  if (managerStores.size === 0) return false;
  return getStoreAccountStoreCores(account).some((storeCore) => managerStores.has(storeCore));
};

export const buildStoreLoginRegionOptions = ({
  storeAccounts = [],
  managers = {},
  managerNames = [],
} = {}) => {
  const orderedManagerNames = (managerNames || [])
    .map((name) => String(name || "").trim())
    .filter(Boolean);

  const options = orderedManagerNames
    .filter((managerName) => (
      (storeAccounts || []).some((account) => storeAccountBelongsToManager(account, managerName, managers))
    ))
    .map((managerName) => ({ value: managerName, label: managerName }));

  const hasUnassignedAccount = (storeAccounts || []).some((account) => (
    !orderedManagerNames.some((managerName) => storeAccountBelongsToManager(account, managerName, managers))
  ));

  if (hasUnassignedAccount) {
    options.push({
      value: STORE_LOGIN_UNASSIGNED_REGION,
      label: "未分區／其他",
    });
  }

  return options;
};

export const filterStoreAccountsForLoginRegion = ({
  storeAccounts = [],
  managers = {},
  managerNames = [],
  selectedRegion = "",
} = {}) => {
  const region = String(selectedRegion || "").trim();
  if (!region) return [];

  const orderedManagerNames = (managerNames || [])
    .map((name) => String(name || "").trim())
    .filter(Boolean);

  if (region === STORE_LOGIN_UNASSIGNED_REGION) {
    return (storeAccounts || []).filter((account) => (
      !orderedManagerNames.some((managerName) => storeAccountBelongsToManager(account, managerName, managers))
    ));
  }

  return (storeAccounts || []).filter((account) => (
    storeAccountBelongsToManager(account, region, managers)
  ));
};

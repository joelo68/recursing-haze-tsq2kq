const crypto = require("crypto");
const { APPLICATION_IDENTITY_VERSION } = require("./applicationIdentity");
const { updateTherapistCredentialPasswordInTransaction } = require("./therapistCredentialAuthority");

const ACCOUNT_AUTHORITY_RUNTIME_SERVICE_ACCOUNT =
  "drcyj-account-authority@cyjsituation-analysis.iam.gserviceaccount.com";
const SUPPORTED_PASSWORD_ROLES = new Set([
  "director",
  "trainer",
  "manager",
  "store",
  "therapist",
]);
const KNOWN_INITIAL_PASSWORDS = Object.freeze({
  director: Object.freeze({
    cyj: Object.freeze(["16500", "0000"]),
    anniu: Object.freeze(["8888", "0000"]),
    yibo: Object.freeze(["9999", "0000"]),
  }),
  default: Object.freeze(["0000"]),
});
const WEAK_NEW_PASSWORDS = new Set([
  "0000",
  "1111",
  "1234",
  "8888",
  "9999",
  "16500",
  "password",
]);

class AccountAuthorityError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

function safePasswordMatch(input = "", expected = "") {
  const a = Buffer.from(String(input || ""));
  const b = Buffer.from(String(expected || ""));
  if (!a.length || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function normalizePassword(value = "") {
  return String(value ?? "");
}

function normalizeNewPassword(value = "") {
  return String(value ?? "").trim();
}

function assertNewPassword(newPassword, currentPassword = "") {
  if (!newPassword.length) throw new AccountAuthorityError("missing_new_password", 400);
  if (newPassword.length < 4) throw new AccountAuthorityError("new_password_too_short", 400);
  if (newPassword.length > 160) throw new AccountAuthorityError("new_password_too_long", 400);
  if (safePasswordMatch(newPassword, currentPassword)) throw new AccountAuthorityError("new_password_matches_current", 400);
  if (WEAK_NEW_PASSWORDS.has(newPassword.toLowerCase())) throw new AccountAuthorityError("weak_new_password", 400);
}

function getInitialPasswordsForRole(roleId = "", brandId = "") {
  const role = String(roleId || "").trim().toLowerCase();
  const brand = String(brandId || "cyj").trim().toLowerCase();
  if (role === "director") return KNOWN_INITIAL_PASSWORDS.director[brand] || KNOWN_INITIAL_PASSWORDS.director.cyj;
  if (SUPPORTED_PASSWORD_ROLES.has(role)) return KNOWN_INITIAL_PASSWORDS.default;
  return [];
}

function isBootstrapInitialCredential({ brandId, roleId, currentPassword }) {
  return getInitialPasswordsForRole(roleId, brandId)
    .some((candidate) => safePasswordMatch(currentPassword, candidate));
}

function getSnapshotData(snapshot) {
  return snapshot?.exists ? (snapshot.data() || {}) : {};
}

function findObjectAccountKey(accounts = {}, accountId = "") {
  const id = String(accountId || "");
  if (Object.prototype.hasOwnProperty.call(accounts, id)) return id;
  return Object.keys(accounts).find((key) => {
    const raw = accounts[key];
    const account = raw && typeof raw === "object" ? raw : {};
    return String(account.id || account.name || key) === id;
  }) || "";
}

function updateDirectorPasswordData(raw = {}, accountId = "", currentPassword = "", newPassword = "", nowText = "") {
  const next = { ...(raw || {}) };
  const accounts = next.accounts && typeof next.accounts === "object" && Object.keys(next.accounts).length
    ? { ...next.accounts }
    : null;

  if (accounts) {
    const key = findObjectAccountKey(accounts, accountId);
    if (!key) throw new AccountAuthorityError("account_missing", 404);
    const existing = accounts[key];
    const account = existing && typeof existing === "object" ? { ...existing } : { password: String(existing || "") };
    if (account.isActive === false) throw new AccountAuthorityError("account_inactive", 403);
    if (!safePasswordMatch(currentPassword, account.password || "0000")) throw new AccountAuthorityError("credential_changed", 409);
    accounts[key] = { ...account, password: newPassword, updatedAtText: nowText };
    return { ...next, accounts };
  }

  const directKey = Object.keys(next).find((key) => {
    if (["accounts", "directorOrder", "password"].includes(key)) return false;
    const rawAccount = next[key];
    if (key === accountId) return true;
    if (rawAccount && typeof rawAccount === "object") {
      return String(rawAccount.id || rawAccount.name || key) === String(accountId);
    }
    return false;
  });

  if (directKey) {
    const existing = next[directKey];
    if (existing && typeof existing === "object") {
      if (existing.isActive === false) throw new AccountAuthorityError("account_inactive", 403);
      if (!safePasswordMatch(currentPassword, existing.password || "0000")) throw new AccountAuthorityError("credential_changed", 409);
      next[directKey] = { ...existing, password: newPassword, updatedAtText: nowText };
    } else {
      if (!safePasswordMatch(currentPassword, existing || "")) throw new AccountAuthorityError("credential_changed", 409);
      next[directKey] = newPassword;
    }
    return next;
  }

  if (String(accountId) === "營運總監" && next.password) {
    if (!safePasswordMatch(currentPassword, next.password)) throw new AccountAuthorityError("credential_changed", 409);
    next.password = newPassword;
    return next;
  }

  throw new AccountAuthorityError("account_missing", 404);
}

function updateTrainerPasswordData(raw = {}, accountId = "", currentPassword = "", newPassword = "", nowText = "") {
  const next = { ...(raw || {}) };
  const hasAccounts = next.accounts && typeof next.accounts === "object" && Object.keys(next.accounts).length;
  if (!hasAccounts) {
    if (String(accountId) !== "trainer_default") throw new AccountAuthorityError("account_missing", 404);
    if (!safePasswordMatch(currentPassword, next.password || "0000")) throw new AccountAuthorityError("credential_changed", 409);
    return { ...next, password: newPassword, updatedAtText: nowText };
  }
  const accounts = { ...next.accounts };
  const key = findObjectAccountKey(accounts, accountId);
  if (!key) throw new AccountAuthorityError("account_missing", 404);
  const existing = accounts[key];
  const account = existing && typeof existing === "object" ? { ...existing } : { password: String(existing || "") };
  if (account.isActive === false) throw new AccountAuthorityError("account_inactive", 403);
  if (!safePasswordMatch(currentPassword, account.password || "0000")) throw new AccountAuthorityError("credential_changed", 409);
  accounts[key] = { ...account, password: newPassword, updatedAtText: nowText };
  return { ...next, accounts };
}

function updateManagerPasswordData(raw = {}, accountId = "", currentPassword = "", newPassword = "", nowText = "") {
  const next = { ...(raw || {}) };
  if (!Object.prototype.hasOwnProperty.call(next, accountId)) throw new AccountAuthorityError("account_missing", 404);
  const existing = next[accountId];
  if (existing && typeof existing === "object") {
    if (!safePasswordMatch(currentPassword, existing.password || "")) throw new AccountAuthorityError("credential_changed", 409);
    next[accountId] = { ...existing, password: newPassword, updatedAtText: nowText };
  } else {
    if (!safePasswordMatch(currentPassword, existing || "")) throw new AccountAuthorityError("credential_changed", 409);
    next[accountId] = newPassword;
  }
  return next;
}

function updateStorePasswordData(raw = {}, accountId = "", currentPassword = "", newPassword = "", nowText = "") {
  const next = { ...(raw || {}) };
  const accounts = Array.isArray(next.accounts) ? next.accounts.map((item) => ({ ...(item || {}) })) : [];
  const index = accounts.findIndex((item) => String(item.id || "") === String(accountId)) >= 0
    ? accounts.findIndex((item) => String(item.id || "") === String(accountId))
    : accounts.findIndex((item) => String(item.name || "") === String(accountId));
  if (index < 0) throw new AccountAuthorityError("account_missing", 404);
  const account = accounts[index];
  if (!safePasswordMatch(currentPassword, account.password || "")) throw new AccountAuthorityError("credential_changed", 409);
  accounts[index] = { ...account, password: newPassword, updatedAtText: nowText };
  return { ...next, accounts };
}

async function writePasswordChangeInTransaction({ transaction, db, brandId, roleId, accountId, currentPassword, newPassword, nowText, getBrandCollection, getBrandSettingDoc }) {
  if (roleId === "therapist") {
    await updateTherapistCredentialPasswordInTransaction({
      transaction,
      db,
      brandId,
      therapistId: accountId,
      currentPassword,
      newPassword,
      nowText,
      getBrandCollection,
      passwordMatches: safePasswordMatch,
    });
    return;
  }

  const docName = ({
    director: "director_auth",
    trainer: "trainer_auth",
    manager: "manager_auth",
    store: "store_account_data",
  })[roleId];
  if (!docName) throw new AccountAuthorityError("unsupported_role", 400);

  const ref = getBrandSettingDoc(db, brandId, docName);
  const snap = await transaction.get(ref);
  if (!snap.exists) throw new AccountAuthorityError("credential_source_missing", 404);
  const raw = getSnapshotData(snap);
  const next = roleId === "director"
    ? updateDirectorPasswordData(raw, accountId, currentPassword, newPassword, nowText)
    : roleId === "trainer"
      ? updateTrainerPasswordData(raw, accountId, currentPassword, newPassword, nowText)
      : roleId === "manager"
        ? updateManagerPasswordData(raw, accountId, currentPassword, newPassword, nowText)
        : updateStorePasswordData(raw, accountId, currentPassword, newPassword, nowText);
  transaction.set(ref, next, { merge: false });
}

function validateApplicationClaims(requestAuth = {}, { brandId, roleId, accountId }) {
  const decoded = requestAuth?.decoded || {};
  if (decoded?.drcyjIdentity !== true) {
    const provider = String(decoded?.firebase?.sign_in_provider || "");
    return provider === "anonymous"
      ? { ok: true, mode: "bootstrap" }
      : { ok: false, mode: "bootstrap" };
  }
  const valid =
    String(decoded.identityVersion || "") === APPLICATION_IDENTITY_VERSION &&
    String(decoded.brandId || "").toLowerCase() === String(brandId || "").toLowerCase() &&
    String(decoded.roleId || "").toLowerCase() === String(roleId || "").toLowerCase() &&
    String(decoded.accountId || "") === String(accountId || "");
  return valid ? { ok: true, mode: "application_identity" } : { ok: false, mode: "application_identity" };
}



const MANAGED_ACCOUNT_ROLES = new Set(["director", "trainer", "manager", "store"]);
const DIRECTOR_LEVELS = new Set(["super_admin", "operation_admin", "finance_admin", "viewer"]);

function normalizeAccountText(value = "", maxLength = 120) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function assertSupportedBrandId(value = "") {
  const brandId = String(value || "").trim().toLowerCase();
  if (!["cyj", "anniu", "yibo"].includes(brandId)) throw new AccountAuthorityError("invalid_brand", 400);
  return brandId;
}

function normalizeAccountStores(value = []) {
  const list = Array.isArray(value) ? value : [value];
  return [...new Set(list.map((item) => normalizeAccountText(item, 160)).filter(Boolean))].slice(0, 64);
}

function getDefaultDirectorLevel(name = "") {
  const text = String(name || "");
  if (text.includes("董事長") || text.includes("總經理")) return "super_admin";
  if (text.includes("財務")) return "finance_admin";
  return "operation_admin";
}

function getInitialPasswordForManagedAccount(roleId = "", brandId = "") {
  const candidates = getInitialPasswordsForRole(roleId, brandId);
  const password = String(candidates?.[0] || "");
  if (!password) throw new AccountAuthorityError("initial_password_unavailable", 500);
  return password;
}

function normalizeDirectorAuthForAdmin(raw = {}) {
  const source = raw && typeof raw === "object" ? { ...raw } : {};
  const hasAccounts = source.accounts && typeof source.accounts === "object";
  const accounts = hasAccounts ? { ...source.accounts } : {};

  if (!hasAccounts) {
    Object.entries(source).forEach(([key, value]) => {
      if (["accounts", "directorOrder", "password"].includes(key)) return;
      if (value && typeof value === "object") accounts[key] = { ...value, name: value.name || key };
      else accounts[key] = { name: key, password: String(value || "0000") };
    });
    if (source.password && Object.keys(accounts).length === 0) {
      accounts["營運總監"] = { name: "營運總監", password: source.password };
    }
  }

  const normalized = {};
  Object.entries(accounts).forEach(([key, rawAccount]) => {
    const account = rawAccount && typeof rawAccount === "object"
      ? { ...rawAccount }
      : { password: String(rawAccount || "") };
    const name = normalizeAccountText(account.name || key);
    const id = normalizeAccountText(account.id || key);
    if (!name || !id) return;
    normalized[key] = {
      ...account,
      id,
      name,
      password: String(account.password || "0000"),
      level: DIRECTOR_LEVELS.has(String(account.level || account.directorLevel || ""))
        ? String(account.level || account.directorLevel)
        : getDefaultDirectorLevel(name),
      isActive: account.isActive !== false,
    };
  });

  const existing = new Set(Object.keys(normalized));
  const order = [];
  (Array.isArray(source.directorOrder) ? source.directorOrder : []).forEach((key) => {
    const id = String(key || "");
    if (existing.has(id) && !order.includes(id)) order.push(id);
  });
  Object.keys(normalized).forEach((key) => {
    if (!order.includes(key)) order.push(key);
  });

  return { ...source, accounts: normalized, directorOrder: order };
}

function normalizeTrainerAuthForAdmin(raw = {}) {
  const source = raw && typeof raw === "object" ? { ...raw } : {};
  const hasAccounts = source.accounts && typeof source.accounts === "object" && Object.keys(source.accounts).length > 0;
  const accounts = hasAccounts
    ? { ...source.accounts }
    : {
        trainer_default: {
          id: "trainer_default",
          name: normalizeAccountText(source.name || "教專"),
          password: String(source.password || "0000"),
          isActive: source.isActive !== false,
          isLegacyDefault: true,
        },
      };

  const normalized = {};
  Object.entries(accounts).forEach(([key, rawAccount]) => {
    const account = rawAccount && typeof rawAccount === "object"
      ? { ...rawAccount }
      : { password: String(rawAccount || "") };
    const id = normalizeAccountText(account.id || key);
    const name = normalizeAccountText(account.name || (id === "trainer_default" ? "教專" : key));
    if (!id || !name) return;
    normalized[id] = {
      ...account,
      id,
      name,
      password: String(account.password || "0000"),
      isActive: account.isActive !== false,
    };
  });

  const existing = new Set(Object.keys(normalized));
  const order = [];
  (Array.isArray(source.trainerOrder) ? source.trainerOrder : []).forEach((id) => {
    const key = String(id || "");
    if (existing.has(key) && !order.includes(key)) order.push(key);
  });
  Object.keys(normalized).forEach((id) => {
    if (!order.includes(id)) order.push(id);
  });

  return { ...source, accounts: normalized, trainerOrder: order };
}

function assertAdminApplicationClaims(requestAuth = {}, brandId = "", actor = {}, adminCheck = {}) {
  const decoded = requestAuth?.decoded || {};
  const actorAccountId = normalizeAccountText(actor?.accountId);
  const verifiedAccountId = normalizeAccountText(adminCheck?.actorAccountId || actorAccountId);
  const valid =
    decoded?.drcyjIdentity === true &&
    String(decoded.identityVersion || "") === APPLICATION_IDENTITY_VERSION &&
    String(decoded.brandId || "").toLowerCase() === String(brandId || "").toLowerCase() &&
    String(decoded.roleId || "").toLowerCase() === "director" &&
    String(decoded.accountId || "") === actorAccountId &&
    actorAccountId &&
    verifiedAccountId === actorAccountId;
  if (!valid) throw new AccountAuthorityError("admin_application_identity_mismatch", 403);
}

function assertActiveSuperAdminRemains(directorAuth = {}) {
  const activeSuperAdmins = Object.values(directorAuth.accounts || {}).filter((account) => (
    account?.isActive !== false && String(account?.level || "") === "super_admin"
  ));
  if (activeSuperAdmins.length < 1) throw new AccountAuthorityError("last_super_admin_required", 409);
}

function getOrganizationStoreSet(raw = {}) {
  const managers = raw?.managers && typeof raw.managers === "object" ? raw.managers : {};
  const stores = new Set();
  Object.values(managers).forEach((value) => {
    (Array.isArray(value) ? value : []).forEach((store) => {
      const name = normalizeAccountText(store, 160);
      if (name) stores.add(name);
    });
  });
  return stores;
}

function validateStoreAssignments(requestedStores = [], organizationStores = new Set(), accounts = [], targetAccountId = "") {
  const stores = normalizeAccountStores(requestedStores);
  for (const store of stores) {
    if (!organizationStores.has(store)) throw new AccountAuthorityError("store_outside_brand_organization", 400);
  }
  const target = String(targetAccountId || "");
  const usedByOther = new Set();
  (Array.isArray(accounts) ? accounts : []).forEach((account) => {
    if (String(account?.id || "") === target) return;
    normalizeAccountStores(account?.stores || []).forEach((store) => usedByOther.add(store));
  });
  if (stores.some((store) => usedByOther.has(store))) throw new AccountAuthorityError("store_already_assigned", 409);
  return stores;
}

function applyDirectorAdminAction({ raw, action, targetAccountId, payload, brandId, nowText }) {
  const next = normalizeDirectorAuthForAdmin(raw);
  const target = normalizeAccountText(targetAccountId);
  const data = payload && typeof payload === "object" ? payload : {};

  if (action === "create") {
    const name = normalizeAccountText(data.name || target);
    if (!name) throw new AccountAuthorityError("missing_account_name", 400);
    if (next.accounts[name]) throw new AccountAuthorityError("account_already_exists", 409);
    const level = DIRECTOR_LEVELS.has(String(data.level || "")) ? String(data.level) : getDefaultDirectorLevel(name);
    next.accounts[name] = {
      id: name,
      name,
      password: getInitialPasswordForManagedAccount("director", brandId),
      level,
      isActive: true,
      createdAtText: nowText,
      updatedAtText: nowText,
    };
    next.directorOrder = [...next.directorOrder.filter((item) => item !== name), name];
    return { next, accountId: name };
  }

  if (action === "reorder") {
    const requested = Array.isArray(data.order) ? data.order.map((item) => String(item || "")) : [];
    const existing = new Set(Object.keys(next.accounts));
    next.directorOrder = [
      ...requested.filter((item, index) => existing.has(item) && requested.indexOf(item) === index),
      ...Object.keys(next.accounts).filter((item) => !requested.includes(item)),
    ];
    return { next, accountId: "" };
  }

  if (!target || !next.accounts[target]) throw new AccountAuthorityError("account_missing", 404);

  if (action === "rename") {
    const newName = normalizeAccountText(data.name);
    if (!newName) throw new AccountAuthorityError("missing_account_name", 400);
    if (newName !== target && next.accounts[newName]) throw new AccountAuthorityError("account_already_exists", 409);
    const current = next.accounts[target];
    delete next.accounts[target];
    next.accounts[newName] = { ...current, id: newName, name: newName, updatedAtText: nowText };
    next.directorOrder = next.directorOrder.map((item) => item === target ? newName : item);
    return { next, accountId: newName };
  }

  if (action === "set_level") {
    const level = String(data.level || "");
    if (!DIRECTOR_LEVELS.has(level)) throw new AccountAuthorityError("invalid_director_level", 400);
    const wasActiveSuperAdmin = next.accounts[target].isActive !== false && String(next.accounts[target].level || "") === "super_admin";
    next.accounts[target] = { ...next.accounts[target], level, updatedAtText: nowText };
    if (wasActiveSuperAdmin && level !== "super_admin") assertActiveSuperAdminRemains(next);
    return { next, accountId: target };
  }

  if (action === "set_active") {
    if (typeof data.isActive !== "boolean") throw new AccountAuthorityError("invalid_active_state", 400);
    const wasActiveSuperAdmin = next.accounts[target].isActive !== false && String(next.accounts[target].level || "") === "super_admin";
    next.accounts[target] = { ...next.accounts[target], isActive: data.isActive, updatedAtText: nowText };
    if (wasActiveSuperAdmin && data.isActive === false) assertActiveSuperAdminRemains(next);
    return { next, accountId: target };
  }

  if (action === "reset_password") {
    next.accounts[target] = {
      ...next.accounts[target],
      password: getInitialPasswordForManagedAccount("director", brandId),
      updatedAtText: nowText,
    };
    return { next, accountId: target };
  }

  if (action === "delete") {
    const wasActiveSuperAdmin = next.accounts[target].isActive !== false && String(next.accounts[target].level || "") === "super_admin";
    delete next.accounts[target];
    next.directorOrder = next.directorOrder.filter((item) => item !== target);
    if (wasActiveSuperAdmin) assertActiveSuperAdminRemains(next);
    return { next, accountId: target, deleted: true };
  }

  throw new AccountAuthorityError("unsupported_account_action", 400);
}

function applyTrainerAdminAction({ raw, action, targetAccountId, payload, brandId, nowText }) {
  const next = normalizeTrainerAuthForAdmin(raw);
  const target = normalizeAccountText(targetAccountId);
  const data = payload && typeof payload === "object" ? payload : {};

  if (action === "create") {
    const name = normalizeAccountText(data.name);
    if (!name) throw new AccountAuthorityError("missing_account_name", 400);
    const duplicate = Object.values(next.accounts).some((account) => normalizeAccountText(account?.name) === name);
    if (duplicate) throw new AccountAuthorityError("account_already_exists", 409);
    const id = `trainer_${crypto.randomUUID()}`;
    next.accounts[id] = {
      id,
      name,
      password: getInitialPasswordForManagedAccount("trainer", brandId),
      isActive: true,
      createdAtText: nowText,
      updatedAtText: nowText,
    };
    next.trainerOrder = [...next.trainerOrder.filter((item) => item !== id), id];
    return { next, accountId: id };
  }

  if (action === "reorder") {
    const requested = Array.isArray(data.order) ? data.order.map((item) => String(item || "")) : [];
    const existing = new Set(Object.keys(next.accounts));
    next.trainerOrder = [
      ...requested.filter((item, index) => existing.has(item) && requested.indexOf(item) === index),
      ...Object.keys(next.accounts).filter((item) => !requested.includes(item)),
    ];
    return { next, accountId: "" };
  }

  if (!target || !next.accounts[target]) throw new AccountAuthorityError("account_missing", 404);

  if (action === "update_profile") {
    const name = normalizeAccountText(data.name || next.accounts[target].name);
    if (!name) throw new AccountAuthorityError("missing_account_name", 400);
    const duplicate = Object.values(next.accounts).some((account) => String(account?.id || "") !== target && normalizeAccountText(account?.name) === name);
    if (duplicate) throw new AccountAuthorityError("account_already_exists", 409);
    next.accounts[target] = { ...next.accounts[target], name, updatedAtText: nowText };
    return { next, accountId: target };
  }

  if (action === "set_active") {
    if (typeof data.isActive !== "boolean") throw new AccountAuthorityError("invalid_active_state", 400);
    next.accounts[target] = { ...next.accounts[target], isActive: data.isActive, updatedAtText: nowText };
    return { next, accountId: target };
  }

  if (action === "reset_password") {
    next.accounts[target] = {
      ...next.accounts[target],
      password: getInitialPasswordForManagedAccount("trainer", brandId),
      updatedAtText: nowText,
    };
    return { next, accountId: target };
  }

  if (action === "delete") {
    if (Object.keys(next.accounts).length <= 1) throw new AccountAuthorityError("last_trainer_account_required", 409);
    delete next.accounts[target];
    next.trainerOrder = next.trainerOrder.filter((item) => item !== target);
    return { next, accountId: target, deleted: true };
  }

  throw new AccountAuthorityError("unsupported_account_action", 400);
}

function applyManagerAdminAction({ raw, action, targetAccountId, brandId, nowText }) {
  if (action !== "reset_password") throw new AccountAuthorityError("manager_org_authority_required", 409);
  const target = normalizeAccountText(targetAccountId);
  const next = raw && typeof raw === "object" ? { ...raw } : {};
  if (!target || !Object.prototype.hasOwnProperty.call(next, target)) throw new AccountAuthorityError("account_missing", 404);
  const current = next[target];
  const password = getInitialPasswordForManagedAccount("manager", brandId);
  next[target] = current && typeof current === "object"
    ? { ...current, password, updatedAtText: nowText }
    : password;
  return { next, accountId: target };
}

function applyStoreAdminAction({ raw, organizationRaw, action, targetAccountId, payload, brandId, nowText }) {
  const source = raw && typeof raw === "object" ? { ...raw } : {};
  const accounts = Array.isArray(source.accounts) ? source.accounts.map((item) => ({ ...(item || {}) })) : [];
  const data = payload && typeof payload === "object" ? payload : {};
  const target = normalizeAccountText(targetAccountId);
  const orgStores = getOrganizationStoreSet(organizationRaw);

  if (action === "create") {
    const name = normalizeAccountText(data.name);
    if (!name) throw new AccountAuthorityError("missing_account_name", 400);
    const stores = validateStoreAssignments(data.stores || [], orgStores, accounts, "");
    const id = `store_${crypto.randomUUID()}`;
    accounts.push({
      id,
      name,
      password: getInitialPasswordForManagedAccount("store", brandId),
      stores,
      createdAtText: nowText,
      updatedAtText: nowText,
    });
    return { next: { ...source, accounts }, accountId: id };
  }

  const index = accounts.findIndex((account) => String(account?.id || "") === target);
  if (index < 0) throw new AccountAuthorityError("account_missing", 404);

  if (action === "update_profile") {
    const name = normalizeAccountText(data.name || accounts[index].name);
    if (!name) throw new AccountAuthorityError("missing_account_name", 400);
    const stores = Object.prototype.hasOwnProperty.call(data, "stores")
      ? validateStoreAssignments(data.stores, orgStores, accounts, target)
      : normalizeAccountStores(accounts[index].stores || []);
    accounts[index] = { ...accounts[index], name, stores, updatedAtText: nowText };
    return { next: { ...source, accounts }, accountId: target };
  }

  if (action === "reset_password") {
    accounts[index] = {
      ...accounts[index],
      password: getInitialPasswordForManagedAccount("store", brandId),
      updatedAtText: nowText,
    };
    return { next: { ...source, accounts }, accountId: target };
  }

  if (action === "delete") {
    const nextAccounts = accounts.filter((_, accountIndex) => accountIndex !== index);
    return { next: { ...source, accounts: nextAccounts }, accountId: target, deleted: true };
  }

  throw new AccountAuthorityError("unsupported_account_action", 400);
}

async function manageAccountInTransaction({ transaction, db, brandId, roleId, action, targetAccountId, payload, nowText, actorCheck, getBrandCollection, getBrandSettingDoc }) {
  const role = String(roleId || "").toLowerCase();
  if (!MANAGED_ACCOUNT_ROLES.has(role)) throw new AccountAuthorityError("unsupported_managed_role", 400);

  const docName = ({ director: "director_auth", trainer: "trainer_auth", manager: "manager_auth", store: "store_account_data" })[role];
  const ref = getBrandSettingDoc(db, brandId, docName);
  const refs = [ref];
  let orgRef = null;
  if (role === "store") {
    orgRef = getBrandSettingDoc(db, brandId, "org_structure");
    refs.push(orgRef);
  }
  const snapshots = await Promise.all(refs.map((item) => transaction.get(item)));
  const accountSnap = snapshots[0];
  if (!accountSnap.exists && action !== "create") throw new AccountAuthorityError("credential_source_missing", 404);
  const raw = accountSnap.exists ? (accountSnap.data() || {}) : {};
  const organizationRaw = orgRef && snapshots[1]?.exists ? (snapshots[1].data() || {}) : {};

  const result = role === "director"
    ? applyDirectorAdminAction({ raw, action, targetAccountId, payload, brandId, nowText })
    : role === "trainer"
      ? applyTrainerAdminAction({ raw, action, targetAccountId, payload, brandId, nowText })
      : role === "manager"
        ? applyManagerAdminAction({ raw, action, targetAccountId, brandId, nowText })
        : applyStoreAdminAction({ raw, organizationRaw, action, targetAccountId, payload, brandId, nowText });

  if (
    role === "director" &&
    ["rename", "set_level", "set_active", "delete"].includes(String(action || "").toLowerCase()) &&
    normalizeAccountText(targetAccountId) === normalizeAccountText(actorCheck?.actorAccountId)
  ) {
    throw new AccountAuthorityError("self_account_admin_action_not_allowed", 409);
  }

  transaction.set(ref, result.next, { merge: false });

  const auditRef = getBrandCollection(db, brandId, "system_logs").doc();
  transaction.set(auditRef, {
    createdAtText: nowText,
    activityType: "auth.account_management",
    action: "帳號管理",
    role: "director",
    user: String(actorCheck?.actorName || actorCheck?.actorAccountId || "最高管理者"),
    brand: brandId,
    details: {
      managedRole: role,
      managedAction: action,
      targetAccountId: result.accountId,
      passwordReset: action === "reset_password" || action === "create",
      deleted: result.deleted === true,
    },
  }, { merge: false });

  return result;
}

function createAccountAuthorityFunctions({
  onRequest,
  db,
  normalizeBrandId,
  getBrandCollection,
  getBrandSettingDoc,
  requireFirebaseRequestAuth,
  verifyApplicationCredential,
  verifySuperAdminActor,
}) {
  const changeApplicationPassword = onRequest({
    cors: true,
    timeoutSeconds: 20,
    memory: "256MiB",
    serviceAccount: ACCOUNT_AUTHORITY_RUNTIME_SERVICE_ACCOUNT,
  }, async (req, res) => {
    if (req.method !== "POST") return res.status(405).json({ ok: false, code: "method_not_allowed" });
    res.set?.("Cache-Control", "private, no-store");

    const requestAuth = await requireFirebaseRequestAuth(req);
    if (!requestAuth?.ok) return res.status(401).json({ ok: false, code: "firebase_auth_required" });

    try {
      const body = req.body || {};
      const brandId = normalizeBrandId(body.brandId);
      const roleId = String(body.roleId || "").trim().toLowerCase();
      const requestedAccountId = String(body.accountId || "").trim();
      const currentPassword = normalizePassword(body.currentPassword);
      const newPassword = normalizeNewPassword(body.newPassword);

      if (!SUPPORTED_PASSWORD_ROLES.has(roleId)) throw new AccountAuthorityError("unsupported_role", 400);
      if (!requestedAccountId || !currentPassword) throw new AccountAuthorityError("missing_credential", 400);
      assertNewPassword(newPassword, currentPassword);

      const credential = await verifyApplicationCredential({
        db,
        brandId,
        roleId,
        accountId: requestedAccountId,
        password: currentPassword,
      });
      if (!credential?.ok) throw new AccountAuthorityError("credential_rejected", 401);
      if (credential?.isMasterCredential === true) throw new AccountAuthorityError("master_override_not_allowed", 403);

      const accountId = String(credential.accountId || requestedAccountId).trim();
      const claimBoundary = validateApplicationClaims(requestAuth, { brandId, roleId, accountId });
      if (!claimBoundary.ok) {
        throw new AccountAuthorityError(
          claimBoundary.mode === "bootstrap" ? "firebase_identity_not_allowed" : "application_identity_mismatch",
          403
        );
      }
      if (claimBoundary.mode === "bootstrap" && !isBootstrapInitialCredential({ brandId, roleId, currentPassword })) {
        throw new AccountAuthorityError("bootstrap_initial_password_required", 403);
      }

      const nowText = new Date().toISOString();
      await db.runTransaction(async (transaction) => {
        await writePasswordChangeInTransaction({
          transaction,
          db,
          brandId,
          roleId,
          accountId,
          currentPassword,
          newPassword,
          nowText,
          getBrandCollection,
          getBrandSettingDoc,
        });
      });

      return res.status(200).json({
        ok: true,
        changed: true,
        brandId,
        roleId,
        accountId,
        authMode: claimBoundary.mode,
        updatedAtText: nowText,
      });
    } catch (error) {
      const status = Number(error?.status || 500);
      const code = String(error?.code || "password_change_failed");
      if (status >= 500) console.error("changeApplicationPassword failed", code);
      return res.status(status).json({ ok: false, code });
    }
  });


  const manageApplicationAccount = onRequest({
    cors: true,
    timeoutSeconds: 20,
    memory: "256MiB",
    serviceAccount: ACCOUNT_AUTHORITY_RUNTIME_SERVICE_ACCOUNT,
  }, async (req, res) => {
    if (req.method !== "POST") return res.status(405).json({ ok: false, code: "method_not_allowed" });
    res.set?.("Cache-Control", "private, no-store");

    const requestAuth = await requireFirebaseRequestAuth(req);
    if (!requestAuth?.ok) return res.status(401).json({ ok: false, code: "firebase_auth_required" });

    try {
      const body = req.body || {};
      const requestedBrandId = assertSupportedBrandId(body.brandId);
      const brandId = normalizeBrandId(requestedBrandId);
      const roleId = String(body.roleId || "").trim().toLowerCase();
      const action = String(body.action || "").trim().toLowerCase();
      const targetAccountId = normalizeAccountText(body.accountId);
      const payload = body.payload && typeof body.payload === "object" ? body.payload : {};
      const actor = body.actor && typeof body.actor === "object" ? body.actor : {};

      if (!MANAGED_ACCOUNT_ROLES.has(roleId)) throw new AccountAuthorityError("unsupported_managed_role", 400);
      if (!action) throw new AccountAuthorityError("missing_account_action", 400);
      if (roleId === "manager" && action !== "reset_password") throw new AccountAuthorityError("manager_org_authority_required", 409);

      // 先用 server-issued Application Identity claims 擋掉 anonymous／跨帳號請求，
      // 再進一步讀 Trusted Device 與 credential 做最高管理者重新驗證。
      assertAdminApplicationClaims(requestAuth, brandId, actor, { actorAccountId: actor?.accountId });
      const actorCheck = await verifySuperAdminActor({ db, brandId, actor });
      if (!actorCheck?.ok) throw new AccountAuthorityError("super_admin_reverification_required", 403);
      assertAdminApplicationClaims(requestAuth, brandId, actor, actorCheck);

      const nowText = new Date().toISOString();
      const result = await db.runTransaction(async (transaction) => manageAccountInTransaction({
        transaction,
        db,
        brandId,
        roleId,
        action,
        targetAccountId,
        payload,
        nowText,
        actorCheck,
        getBrandCollection,
        getBrandSettingDoc,
      }));

      return res.status(200).json({
        ok: true,
        changed: true,
        brandId,
        roleId,
        action,
        accountId: result.accountId,
        deleted: result.deleted === true,
        requiresInitialPasswordChange: action === "create" || action === "reset_password",
        updatedAtText: nowText,
      });
    } catch (error) {
      const status = Number(error?.status || 500);
      const code = String(error?.code || "account_management_failed");
      if (status >= 500) console.error("manageApplicationAccount failed", code);
      return res.status(status).json({ ok: false, code });
    }
  });

  return { changeApplicationPassword, manageApplicationAccount };
}

module.exports = {
  ACCOUNT_AUTHORITY_RUNTIME_SERVICE_ACCOUNT,
  SUPPORTED_PASSWORD_ROLES,
  MANAGED_ACCOUNT_ROLES,
  DIRECTOR_LEVELS,
  KNOWN_INITIAL_PASSWORDS,
  AccountAuthorityError,
  createAccountAuthorityFunctions,
  validateApplicationClaims,
  assertAdminApplicationClaims,
  assertSupportedBrandId,
  normalizeDirectorAuthForAdmin,
  normalizeTrainerAuthForAdmin,
  applyDirectorAdminAction,
  applyTrainerAdminAction,
  applyManagerAdminAction,
  applyStoreAdminAction,
  manageAccountInTransaction,
  getInitialPasswordsForRole,
  isBootstrapInitialCredential,
  assertNewPassword,
  updateDirectorPasswordData,
  updateTrainerPasswordData,
  updateManagerPasswordData,
  updateStorePasswordData,
  writePasswordChangeInTransaction,
};

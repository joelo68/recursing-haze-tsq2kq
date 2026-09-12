const crypto = require("crypto");
const { APPLICATION_IDENTITY_VERSION } = require("./applicationIdentity");

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
    const ref = getBrandCollection(db, brandId, "therapists").doc(accountId);
    const snap = await transaction.get(ref);
    if (!snap.exists) throw new AccountAuthorityError("account_missing", 404);
    const data = snap.data() || {};
    const inactive = data.isActive === false || data.resigned === true || data.isResigned === true || ["resigned", "離職"].includes(String(data.status || "").toLowerCase());
    if (inactive) throw new AccountAuthorityError("account_inactive", 403);
    if (!safePasswordMatch(currentPassword, data.password || "")) throw new AccountAuthorityError("credential_changed", 409);
    transaction.set(ref, { password: newPassword, updatedAtText: nowText }, { merge: true });
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

function createAccountAuthorityFunctions({
  onRequest,
  db,
  normalizeBrandId,
  getBrandCollection,
  getBrandSettingDoc,
  requireFirebaseRequestAuth,
  verifyApplicationCredential,
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

  return { changeApplicationPassword };
}

module.exports = {
  ACCOUNT_AUTHORITY_RUNTIME_SERVICE_ACCOUNT,
  SUPPORTED_PASSWORD_ROLES,
  KNOWN_INITIAL_PASSWORDS,
  AccountAuthorityError,
  createAccountAuthorityFunctions,
  validateApplicationClaims,
  getInitialPasswordsForRole,
  isBootstrapInitialCredential,
  assertNewPassword,
  updateDirectorPasswordData,
  updateTrainerPasswordData,
  updateManagerPasswordData,
  updateStorePasswordData,
  writePasswordChangeInTransaction,
};

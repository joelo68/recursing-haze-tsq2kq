import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const require = createRequire(import.meta.url);

const {
  ACCOUNT_AUTHORITY_RUNTIME_SERVICE_ACCOUNT,
  createAccountAuthorityFunctions,
  getInitialPasswordsForRole,
  isBootstrapInitialCredential,
  assertNewPassword,
  updateDirectorPasswordData,
  updateTrainerPasswordData,
  updateManagerPasswordData,
  updateStorePasswordData,
} = require("../functions/accountAuthority");

const backend = read("functions/accountAuthority.js");
const deviceApproval = read("functions/deviceApproval.js");
const functionsIndex = read("functions/index.js");
const app = read("src/App.jsx");
const rules = read("firestore.rules");

const makeResponse = () => ({
  statusCode: 200,
  body: null,
  headers: {},
  set(name, value) { this.headers[name] = value; return this; },
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return body; },
});

const makeSnapshot = (ref) => ({ exists: ref.exists !== false, data: () => ref.data, id: ref.id || "" });

function makeFactory({ dataBySetting = {}, therapistData = {}, requestAuth, credential }) {
  const settingRefs = new Map();
  const therapistRefs = new Map();
  const writes = [];
  let transactionCount = 0;
  const refForSetting = (brandId, name) => {
    const key = `${brandId}:${name}`;
    if (!settingRefs.has(key)) settingRefs.set(key, { key, data: structuredClone(dataBySetting[name] || {}), exists: Object.prototype.hasOwnProperty.call(dataBySetting, name) });
    return settingRefs.get(key);
  };
  const refForTherapist = (brandId, id) => {
    const key = `${brandId}:therapists:${id}`;
    if (!therapistRefs.has(key)) therapistRefs.set(key, { key, id, data: structuredClone(therapistData[id] || {}), exists: Object.prototype.hasOwnProperty.call(therapistData, id) });
    return therapistRefs.get(key);
  };
  const db = {
    async runTransaction(callback) {
      transactionCount += 1;
      const tx = {
        async get(ref) { return makeSnapshot(ref); },
        set(ref, data, options = {}) {
          writes.push({ ref: ref.key, data: structuredClone(data), options });
          ref.data = options.merge ? { ...(ref.data || {}), ...structuredClone(data) } : structuredClone(data);
          ref.exists = true;
        },
      };
      return callback(tx);
    },
  };
  const fakeOnRequest = (options, handler) => { handler.options = options; return handler; };
  const factory = createAccountAuthorityFunctions({
    onRequest: fakeOnRequest,
    db,
    normalizeBrandId: (value) => ["cyj", "anniu", "yibo"].includes(String(value || "").toLowerCase()) ? String(value).toLowerCase() : "cyj",
    getBrandSettingDoc: (_db, brandId, name) => refForSetting(brandId, name),
    getBrandCollection: (_db, brandId, name) => ({ doc: (id) => refForTherapist(brandId, id) }),
    requireFirebaseRequestAuth: async () => requestAuth || ({ ok: true, uid: "anon", decoded: { firebase: { sign_in_provider: "anonymous" } } }),
    verifyApplicationCredential: async () => credential || ({ ok: true, accountId: "acct-1", userName: "User" }),
  });
  return { factory, settingRefs, therapistRefs, writes, get transactionCount() { return transactionCount; } };
}

test("B1C1A keeps a separate runtime authority while B1C2C1 explicitly cuts first-login password updates over to it", () => {
  assert.equal(ACCOUNT_AUTHORITY_RUNTIME_SERVICE_ACCOUNT, "drcyj-account-authority@cyjsituation-analysis.iam.gserviceaccount.com");
  assert.match(backend, /serviceAccount:\s*ACCOUNT_AUTHORITY_RUNTIME_SERVICE_ACCOUNT/);
  assert.doesNotMatch(backend, /drcyj-application-identity@/);
  assert.doesNotMatch(backend, /artifacts\/default-app-id\/public\/data|collection\('brands'\)/);
  assert.match(deviceApproval, /verifyApplicationCredential,/);
  assert.match(functionsIndex, /exports\.changeApplicationPassword\s*=\s*accountAuthorityFunctions\.changeApplicationPassword/);
  assert.match(app, /const CHANGE_APPLICATION_PASSWORD_ENDPOINT\s*=\s*"https:\/\/us-central1-cyjsituation-analysis\.cloudfunctions\.net\/changeApplicationPassword"/);
  assert.match(app, /const changeApplicationPassword = useCallback/);
  assert.match(app, /onChangeApplicationPassword=\{changeApplicationPassword\}/);
  assert.match(app, /CURRENT_APP_VERSION\s*=\s*"3\.6\.0"/);
  assert.match(rules, /function signedIn\(\)\s*\{\s*return request\.auth != null;/);
  assert.doesNotMatch(rules, /request\.auth\.token\.drcyjIdentity/);
});
test("role data adapters update only password-bearing account data while preserving neighboring fields", () => {
  const now = "2026-09-12T08:00:00.000Z";
  assert.equal(updateDirectorPasswordData({ accounts: { d1: { id: "d1", name: "主管", password: "old", level: "super_admin" } }, directorOrder: ["d1"] }, "d1", "old", "new", now).accounts.d1.password, "new");
  assert.equal(updateTrainerPasswordData({ accounts: { t1: { id: "t1", name: "教專", password: "old", isActive: true } }, trainerOrder: ["t1"] }, "t1", "old", "new", now).accounts.t1.password, "new");
  assert.equal(updateManagerPasswordData({ 北區長: "old", 南區長: "keep" }, "北區長", "old", "new", now).南區長, "keep");
  assert.equal(updateStorePasswordData({ accounts: [{ id: "s1", name: "店長", password: "old", stores: ["A店"] }, { id: "s2", password: "keep" }] }, "s1", "old", "new", now).accounts[1].password, "keep");
});

test("bootstrap self-service is limited to anonymous first-login initial credentials", async () => {
  assert.deepEqual(getInitialPasswordsForRole("director", "cyj"), ["16500", "0000"]);
  assert.deepEqual(getInitialPasswordsForRole("director", "anniu"), ["8888", "0000"]);
  assert.deepEqual(getInitialPasswordsForRole("director", "yibo"), ["9999", "0000"]);
  assert.deepEqual(getInitialPasswordsForRole("store", "cyj"), ["0000"]);
  assert.equal(isBootstrapInitialCredential({ brandId: "anniu", roleId: "director", currentPassword: "8888" }), true);
  assert.equal(isBootstrapInitialCredential({ brandId: "cyj", roleId: "director", currentPassword: "8888" }), false);

  const env = makeFactory({
    dataBySetting: { store_account_data: { accounts: [{ id: "acct-1", name: "店長", password: "0000", stores: ["A店"] }] } },
    credential: { ok: true, accountId: "acct-1", userName: "店長" },
  });
  const res = makeResponse();
  await env.factory.changeApplicationPassword({ method: "POST", headers: { authorization: "Bearer token" }, body: { brandId: "anniu", roleId: "store", accountId: "acct-1", currentPassword: "0000", newPassword: "new-secret" } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.authMode, "bootstrap");
  assert.equal(env.transactionCount, 1);
  assert.equal(env.settingRefs.get("anniu:store_account_data").data.accounts[0].password, "new-secret");
  assert.doesNotMatch(JSON.stringify(res.body), /new-secret|0000/);
  assert.equal(res.headers["Cache-Control"], "private, no-store");
});

test("bootstrap rejects non-initial credentials before any transaction", async () => {
  const env = makeFactory({
    dataBySetting: { store_account_data: { accounts: [{ id: "acct-1", name: "店長", password: "already-private", stores: ["A店"] }] } },
    credential: { ok: true, accountId: "acct-1", userName: "店長" },
  });
  const res = makeResponse();
  await env.factory.changeApplicationPassword({ method: "POST", headers: { authorization: "Bearer token" }, body: { brandId: "cyj", roleId: "store", accountId: "acct-1", currentPassword: "already-private", newPassword: "next-private" } }, res);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, "bootstrap_initial_password_required");
  assert.equal(env.transactionCount, 0);
  assert.equal(env.writes.length, 0);
});

test("bootstrap rejects non-anonymous Firebase principals without application identity claims", async () => {
  const env = makeFactory({
    dataBySetting: { manager_auth: { mgr1: "0000" } },
    credential: { ok: true, accountId: "mgr1", userName: "Manager" },
    requestAuth: { ok: true, uid: "u", decoded: { firebase: { sign_in_provider: "password" } } },
  });
  const res = makeResponse();
  await env.factory.changeApplicationPassword({ method: "POST", headers: { authorization: "Bearer token" }, body: { brandId: "cyj", roleId: "manager", accountId: "mgr1", currentPassword: "0000", newPassword: "safe-next" } }, res);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, "firebase_identity_not_allowed");
  assert.equal(env.transactionCount, 0);
});

test("backend enforces new-password strength instead of trusting frontend validation", () => {
  assert.throws(() => assertNewPassword("123", "0000"), (error) => error.code === "new_password_too_short");
  assert.throws(() => assertNewPassword("1234", "0000"), (error) => error.code === "weak_new_password");
  assert.throws(() => assertNewPassword("16500", "0000"), (error) => error.code === "weak_new_password");
  assert.throws(() => assertNewPassword("same-secret", "same-secret"), (error) => error.code === "new_password_matches_current");
  assert.doesNotThrow(() => assertNewPassword("safe-secret", "old-secret"));
});

test("application identity session can change a non-initial self password", async () => {
  const env = makeFactory({
    dataBySetting: { manager_auth: { mgr1: "old-private" } },
    credential: { ok: true, accountId: "mgr1", userName: "Manager" },
    requestAuth: { ok: true, uid: "u", decoded: { drcyjIdentity: true, identityVersion: "application-identity-v1", brandId: "cyj", roleId: "manager", accountId: "mgr1" } },
  });
  const res = makeResponse();
  await env.factory.changeApplicationPassword({ method: "POST", headers: { authorization: "Bearer token" }, body: { brandId: "cyj", roleId: "manager", accountId: "mgr1", currentPassword: "old-private", newPassword: "next-private" } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.authMode, "application_identity");
  assert.equal(env.transactionCount, 1);
  assert.equal(env.settingRefs.get("cyj:manager_auth").data.mgr1, "next-private");
});

test("application identity claims must match canonical brand role and account", async () => {
  const env = makeFactory({
    dataBySetting: { manager_auth: { mgr1: "old" } },
    credential: { ok: true, accountId: "mgr1", userName: "Manager" },
    requestAuth: { ok: true, uid: "u", decoded: { drcyjIdentity: true, identityVersion: "application-identity-v1", brandId: "cyj", roleId: "manager", accountId: "other" } },
  });
  const res = makeResponse();
  await env.factory.changeApplicationPassword({ method: "POST", headers: { authorization: "Bearer token" }, body: { brandId: "cyj", roleId: "manager", accountId: "mgr1", currentPassword: "old", newPassword: "new-safe" } }, res);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, "application_identity_mismatch");
  assert.equal(env.transactionCount, 0);
});

test("director master override can never be used as self password authority", async () => {
  const env = makeFactory({ credential: { ok: true, accountId: "d1", userName: "主管", directorLevel: "super_admin", isMasterCredential: true } });
  const res = makeResponse();
  await env.factory.changeApplicationPassword({ method: "POST", headers: { authorization: "Bearer token" }, body: { brandId: "cyj", roleId: "director", accountId: "d1", currentPassword: "master-key", newPassword: "new-safe" } }, res);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, "master_override_not_allowed");
  assert.equal(env.transactionCount, 0);
});

test("transaction fresh-read blocks stale credential races", async () => {
  const env = makeFactory({
    dataBySetting: { manager_auth: { mgr1: "already-changed" } },
    credential: { ok: true, accountId: "mgr1", userName: "Manager" },
    requestAuth: { ok: true, uid: "u", decoded: { drcyjIdentity: true, identityVersion: "application-identity-v1", brandId: "yibo", roleId: "manager", accountId: "mgr1" } },
  });
  const res = makeResponse();
  await env.factory.changeApplicationPassword({ method: "POST", headers: { authorization: "Bearer token" }, body: { brandId: "yibo", roleId: "manager", accountId: "mgr1", currentPassword: "old", newPassword: "new-safe" } }, res);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, "credential_changed");
  assert.equal(env.transactionCount, 1);
  assert.equal(env.writes.length, 0);
});

test("therapist password authority writes only the selected therapist document", async () => {
  const env = makeFactory({
    therapistData: { th1: { name: "A", password: "old-private", isActive: true }, th2: { name: "B", password: "keep", isActive: true } },
    credential: { ok: true, accountId: "th1", userName: "A" },
    requestAuth: { ok: true, uid: "u", decoded: { drcyjIdentity: true, identityVersion: "application-identity-v1", brandId: "cyj", roleId: "therapist", accountId: "th1" } },
  });
  const res = makeResponse();
  await env.factory.changeApplicationPassword({ method: "POST", headers: { authorization: "Bearer token" }, body: { brandId: "cyj", roleId: "therapist", accountId: "th1", currentPassword: "old-private", newPassword: "new-private" } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(env.therapistRefs.get("cyj:therapists:th1").data.password, "new-private");
  assert.equal(env.writes.length, 1);
  assert.equal(env.writes[0].ref, "cyj:therapists:th1");
});

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
} = require("../functions/accountAuthority");

const backend = read("functions/accountAuthority.js");
const functionsIndex = read("functions/index.js");
const app = read("src/App.jsx");
const login = read("src/components/LoginView.jsx");
const settings = read("src/components/SettingsView.jsx");
const therapistManager = read("src/components/TherapistManagerView.jsx");
const rules = read("firestore.rules");

const makeResponse = () => ({
  statusCode: 200,
  body: null,
  headers: {},
  set(name, value) { this.headers[name] = value; return this; },
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return body; },
});

function makeEnv({ settingsData = {}, requestAuth, adminCheck } = {}) {
  const effectiveSettingsData = {
    master_auth: { password: "master-key", revision: 3 },
    ...(settingsData || {}),
  };
  const refs = new Map();
  const writes = [];
  let auditCounter = 0;
  let transactionCount = 0;

  const getSettingRef = (brandId, name) => {
    const key = `${brandId}:settings:${name}`;
    if (!refs.has(key)) {
      const has = Object.prototype.hasOwnProperty.call(effectiveSettingsData, name);
      refs.set(key, { key, exists: has, data: structuredClone(has ? effectiveSettingsData[name] : {}) });
    }
    return refs.get(key);
  };

  const getCollectionRef = (brandId, name) => ({
    doc(id) {
      const docId = id || `audit_${++auditCounter}`;
      const key = `${brandId}:${name}:${docId}`;
      if (!refs.has(key)) refs.set(key, { key, exists: false, data: {} });
      return refs.get(key);
    },
  });

  const db = {
    async runTransaction(callback) {
      transactionCount += 1;
      const tx = {
        async get(ref) {
          return {
            exists: ref.exists,
            data: () => structuredClone(ref.data || {}),
          };
        },
        set(ref, data, options = {}) {
          writes.push({ key: ref.key, data: structuredClone(data), options });
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
    normalizeBrandId: (value) => {
      const brand = String(value || "").toLowerCase();
      return ["cyj", "anniu", "yibo"].includes(brand) ? brand : "cyj";
    },
    getBrandSettingDoc: (_db, brandId, name) => getSettingRef(brandId, name),
    getBrandCollection: (_db, brandId, name) => getCollectionRef(brandId, name),
    requireFirebaseRequestAuth: async () => requestAuth || ({
      ok: true,
      uid: "uid-1",
      decoded: {
        drcyjIdentity: true,
        identityVersion: "application-identity-v1",
        brandId: "cyj",
        roleId: "director",
        accountId: "boss",
      },
    }),
    verifyApplicationCredential: async () => ({ ok: true, accountId: "unused" }),
    verifySuperAdminActor: async () => adminCheck || ({
      ok: true,
      actorName: "Boss",
      actorRole: "director",
      actorAccountId: "boss",
      isMasterCredential: false,
    }),
  });

  const call = async (body) => {
    const res = makeResponse();
    await factory.manageApplicationAccount({
      method: "POST",
      headers: { authorization: "Bearer token" },
      body: {
        brandId: "cyj",
        managementKey: "master-key",
        actor: { roleId: "director", accountId: "boss", deviceId: "dev-1", credentialPassword: "secret" },
        ...body,
      },
    }, res);
    return res;
  };

  return {
    factory,
    refs,
    writes,
    call,
    get transactionCount() { return transactionCount; },
  };
}

test("B1C1B1 account authority is intentionally consumed by post-login director management while LoginView and Rules stay unchanged", () => {
  assert.equal(ACCOUNT_AUTHORITY_RUNTIME_SERVICE_ACCOUNT, "drcyj-account-authority@cyjsituation-analysis.iam.gserviceaccount.com");
  assert.match(backend, /const manageApplicationAccount = onRequest\(/);
  assert.match(backend, /verifySuperAdminActor\(\{ db, brandId, actor \}\)/);
  assert.match(functionsIndex, /exports\.manageApplicationAccount\s*=\s*accountAuthorityFunctions\.manageApplicationAccount/);
  assert.match(app, /const MANAGE_APPLICATION_ACCOUNT_ENDPOINT\s*=\s*"https:\/\/us-central1-cyjsituation-analysis\.cloudfunctions\.net\/manageApplicationAccount"/);
  assert.match(app, /const manageApplicationAccountAction = useCallback/);
  assert.doesNotMatch(login, /manageApplicationAccount/);
  assert.match(settings, /manageApplicationAccountAction/);
  assert.doesNotMatch(therapistManager, /manageApplicationAccount/);
  assert.match(app, /CURRENT_APP_VERSION\s*=\s*"3\.6\.0"/);
  assert.doesNotMatch(rules, /request\.auth\.token\.drcyjIdentity/);
});


test("account management fails closed on an unknown brand instead of falling back to CYJ", async () => {
  const env = makeEnv();
  const res = await env.call({ brandId: "unknown-brand", roleId: "director", action: "create", payload: { name: "主管" } });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, "invalid_brand");
  assert.equal(env.transactionCount, 0);
});

test("account management requires the server-issued director application identity in addition to super-admin re-verification", async () => {
  const env = makeEnv({
    requestAuth: { ok: true, uid: "anon", decoded: { firebase: { sign_in_provider: "anonymous" } } },
  });
  const res = await env.call({ roleId: "director", action: "create", payload: { name: "新主管" } });
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, "admin_application_identity_mismatch");
  assert.equal(env.transactionCount, 0);
});

test("account management rejects a claims/account mismatch even after trusted super-admin credential verification", async () => {
  const env = makeEnv({
    requestAuth: {
      ok: true,
      decoded: { drcyjIdentity: true, identityVersion: "application-identity-v1", brandId: "cyj", roleId: "director", accountId: "other" },
    },
  });
  const res = await env.call({ roleId: "trainer", action: "create", payload: { name: "教專 A" } });
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, "admin_application_identity_mismatch");
  assert.equal(env.transactionCount, 0);
});

test("director create ignores admin-supplied password, uses server initial credential, and never returns password material", async () => {
  const env = makeEnv({
    settingsData: { director_auth: { accounts: { boss: { id: "boss", name: "Boss", password: "keep", level: "super_admin", isActive: true } }, directorOrder: ["boss"] } },
  });
  const res = await env.call({
    roleId: "director",
    action: "create",
    payload: { name: "營運主管A", level: "operation_admin", password: "admin-picked-secret" },
  });
  assert.equal(res.statusCode, 200);
  const stored = env.refs.get("cyj:settings:director_auth").data.accounts["營運主管A"];
  assert.equal(stored.password, getInitialPasswordsForRole("director", "cyj")[0]);
  assert.notEqual(stored.password, "admin-picked-secret");
  assert.equal(res.body.requiresInitialPasswordChange, true);
  assert.equal(Object.prototype.hasOwnProperty.call(res.body, "password"), false);
  assert.doesNotMatch(JSON.stringify(res.body), /admin-picked-secret/i);
  const audit = env.writes.find((write) => write.key.includes(":system_logs:"));
  assert.ok(audit);
  assert.doesNotMatch(JSON.stringify(audit.data), /secret|credentialPassword/i);
});

test("director authority prevents disabling or demoting the last active super-admin", async () => {
  const base = { director_auth: { accounts: { boss: { id: "boss", name: "Boss", password: "keep", level: "super_admin", isActive: true } }, directorOrder: ["boss"] } };
  const disableEnv = makeEnv({ settingsData: base });
  const disabled = await disableEnv.call({ roleId: "director", action: "set_active", accountId: "boss", payload: { isActive: false } });
  assert.equal(disabled.statusCode, 409);
  assert.equal(disabled.body.code, "last_super_admin_required");

  const demoteEnv = makeEnv({ settingsData: base });
  const demoted = await demoteEnv.call({ roleId: "director", action: "set_level", accountId: "boss", payload: { level: "operation_admin" } });
  assert.equal(demoted.statusCode, 409);
  assert.equal(demoted.body.code, "last_super_admin_required");
});

test("trainer authority creates server-id accounts, preserves ordering, and refuses to delete the final trainer account", async () => {
  const env = makeEnv({ settingsData: { trainer_auth: { accounts: { t1: { id: "t1", name: "教專一", password: "keep", isActive: true } }, trainerOrder: ["t1"] } } });
  const created = await env.call({ roleId: "trainer", action: "create", payload: { name: "教專二", password: "must-not-use" } });
  assert.equal(created.statusCode, 200);
  assert.match(created.body.accountId, /^trainer_/);
  const data = env.refs.get("cyj:settings:trainer_auth").data;
  assert.equal(data.accounts[created.body.accountId].password, getInitialPasswordsForRole("trainer", "cyj")[0]);
  assert.deepEqual(data.trainerOrder, ["t1", created.body.accountId]);

  const lastEnv = makeEnv({ settingsData: { trainer_auth: { accounts: { only: { id: "only", name: "唯一教專", password: "keep", isActive: true } }, trainerOrder: ["only"] } } });
  const deleted = await lastEnv.call({ roleId: "trainer", action: "delete", accountId: "only" });
  assert.equal(deleted.statusCode, 409);
  assert.equal(deleted.body.code, "last_trainer_account_required");
});

test("store authority validates brand organization scope and blocks duplicate store assignment", async () => {
  const settingsData = {
    org_structure: { managers: { 北區: ["A店", "B店"], 未分配: ["C店"] } },
    store_account_data: { accounts: [{ id: "s1", name: "店經一", password: "keep", stores: ["A店"] }] },
  };

  const duplicateEnv = makeEnv({ settingsData });
  const duplicate = await duplicateEnv.call({ roleId: "store", action: "create", payload: { name: "店經二", stores: ["A店"] } });
  assert.equal(duplicate.statusCode, 409);
  assert.equal(duplicate.body.code, "store_already_assigned");

  const outsideEnv = makeEnv({ settingsData });
  const outside = await outsideEnv.call({ roleId: "store", action: "create", payload: { name: "店經二", stores: ["跨品牌店"] } });
  assert.equal(outside.statusCode, 400);
  assert.equal(outside.body.code, "store_outside_brand_organization");

  const okEnv = makeEnv({ settingsData });
  const ok = await okEnv.call({ roleId: "store", action: "create", payload: { name: "店經二", stores: ["B店"] } });
  assert.equal(ok.statusCode, 200);
  assert.match(ok.body.accountId, /^store_/);
  const created = okEnv.refs.get("cyj:settings:store_account_data").data.accounts.find((account) => account.id === ok.body.accountId);
  assert.deepEqual(created.stores, ["B店"]);
  assert.equal(created.password, getInitialPasswordsForRole("store", "cyj")[0]);
});

test("manager creation/deletion stays outside B1C1B1 because it must be atomic with org_structure; reset-only is allowed", async () => {
  const blockedEnv = makeEnv({ settingsData: { manager_auth: { 北區長: "private" } } });
  const blocked = await blockedEnv.call({ roleId: "manager", action: "create", payload: { name: "新區長" } });
  assert.equal(blocked.statusCode, 409);
  assert.equal(blocked.body.code, "manager_org_authority_required");
  assert.equal(blockedEnv.transactionCount, 0);

  const resetEnv = makeEnv({ settingsData: { manager_auth: { 北區長: "private" } } });
  const reset = await resetEnv.call({ roleId: "manager", action: "reset_password", accountId: "北區長" });
  assert.equal(reset.statusCode, 200);
  assert.equal(resetEnv.refs.get("cyj:settings:manager_auth").data["北區長"], getInitialPasswordsForRole("manager", "cyj")[0]);
});

test("director management requires the existing highest management key in addition to super-admin re-verification", async () => {
  const base = {
    director_auth: {
      accounts: {
        boss: { id: "boss", name: "Boss", password: "keep", level: "super_admin", isActive: true },
        d2: { id: "d2", name: "主管二", password: "keep2", level: "operation_admin", isActive: true },
      },
      directorOrder: ["boss", "d2"],
    },
  };

  const missingEnv = makeEnv({ settingsData: base });
  const missing = await missingEnv.call({
    roleId: "director",
    action: "set_level",
    accountId: "d2",
    managementKey: "",
    payload: { level: "viewer" },
  });
  assert.equal(missing.statusCode, 403);
  assert.equal(missing.body.code, "master_management_key_required");
  assert.equal(missingEnv.transactionCount, 0);

  const wrongEnv = makeEnv({ settingsData: base });
  const wrong = await wrongEnv.call({
    roleId: "director",
    action: "set_level",
    accountId: "d2",
    managementKey: "wrong-key",
    payload: { level: "viewer" },
  });
  assert.equal(wrong.statusCode, 403);
  assert.equal(wrong.body.code, "master_management_key_invalid");
  assert.equal(wrongEnv.refs.get("cyj:settings:director_auth").data.accounts.d2.level, "operation_admin");
});

test("highest management key can be verified without returning secret material or refreshing account data", async () => {
  const env = makeEnv();
  const res = await env.call({
    roleId: "director",
    action: "verify_master_key",
    managementKey: "master-key",
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.verified, true);
  assert.equal(res.body.changed, false);
  assert.equal(res.body.managementKeyRevision, 3);
  assert.doesNotMatch(JSON.stringify(res.body), /master-key/);
  assert.equal(env.writes.length, 0);
});

test("highest management key change is transactional, audited, and never returns old or new key", async () => {
  const env = makeEnv();
  const res = await env.call({
    roleId: "director",
    action: "change_master_key",
    managementKey: "master-key",
    payload: { newManagementKey: "next-secure-key" },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.changed, true);
  assert.equal(res.body.managementKeyRevision, 4);
  assert.equal(env.refs.get("cyj:settings:master_auth").data.password, "next-secure-key");
  assert.equal(env.refs.get("cyj:settings:master_auth").data.revision, 4);
  assert.doesNotMatch(JSON.stringify(res.body), /master-key|next-secure-key/);
  const audit = env.writes.find((write) => write.key.includes(":system_logs:"));
  assert.ok(audit);
  assert.equal(audit.data.activityType, "auth.master_management_key_change");
  assert.doesNotMatch(JSON.stringify(audit.data), /master-key|next-secure-key|password/i);
});

test("highest management key cannot be changed from a session that itself used the master credential", async () => {
  const env = makeEnv({
    adminCheck: {
      ok: true,
      actorName: "Master",
      actorRole: "master",
      actorAccountId: "boss",
      isMasterCredential: true,
    },
  });
  const res = await env.call({
    roleId: "director",
    action: "change_master_key",
    managementKey: "master-key",
    payload: { newManagementKey: "next-secure-key" },
  });
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, "personal_super_admin_login_required");
  assert.equal(env.refs.get("cyj:settings:master_auth").data.password, "master-key");
});

test("highest management key remains brand-scoped and never falls back across brands", async () => {
  const env = makeEnv({
    settingsData: { master_auth: { password: "yibo-master", revision: 8 } },
    requestAuth: {
      ok: true,
      decoded: {
        drcyjIdentity: true,
        identityVersion: "application-identity-v1",
        brandId: "yibo",
        roleId: "director",
        accountId: "boss",
      },
    },
  });
  const res = await env.call({
    brandId: "yibo",
    roleId: "director",
    action: "verify_master_key",
    managementKey: "yibo-master",
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.managementKeyRevision, 8);
  assert.ok(env.refs.has("yibo:settings:master_auth"));
  assert.equal(env.refs.has("cyj:settings:master_auth"), false);
});

test("therapist master CRUD is intentionally excluded from administrative credential authority", async () => {
  const env = makeEnv();
  const res = await env.call({ roleId: "therapist", action: "create", payload: { name: "管理師" } });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, "unsupported_managed_role");
  assert.equal(env.transactionCount, 0);
});

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
  THERAPIST_MASTER_AUTHORITY_VERSION,
  createTherapistMasterAuthorityFunctions,
  buildTherapistMasterSignature,
  applyTherapistMasterAction,
} = require("../functions/therapistMasterAuthority");

const functionsIndex = read("functions/index.js");
const app = read("src/App.jsx");
const managerView = read("src/components/TherapistManagerView.jsx");
const settings = read("src/components/SettingsView.jsx");
const rules = read("firestore.rules");
const backendSource = read("functions/therapistMasterAuthority.js");

const normalizeStoreCore = (value = "") => {
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

const makeResponse = () => ({
  statusCode: 200,
  body: null,
  headers: {},
  set(name, value) { this.headers[name] = value; return this; },
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return body; },
});

function makeEnv({
  brandId = "cyj",
  org = {
    managers: {
      北區: ["CYJA店", "CYJ新店店"],
      南區: ["CYJC店"],
      未分配: ["CYJD店"],
    },
    managerOrder: ["北區", "南區", "未分配"],
  },
  therapists = {
    t1: {
      id: "t1",
      name: "王小美",
      store: "A",
      storeName: "A",
      stores: ["A"],
      manager: "北區",
      managerName: "北區",
      region: "北區",
      password: "member-secret",
      onboardDate: "2026-01-10",
      resignDate: "",
      status: "在職",
      isActive: true,
      isResigned: false,
      resigned: false,
      legacyTarget: 123,
      createdAtText: "2026-01-10T00:00:00.000Z",
      updatedAtText: "2026-08-01T00:00:00.000Z",
    },
  },
  requestAuth,
  adminCheck,
} = {}) {
  const refs = new Map();
  const writes = [];
  const deletes = [];
  let generated = 0;
  let transactionCount = 0;

  function settingRef(b, name) {
    const key = `${b}:settings:${name}`;
    if (!refs.has(key)) {
      const data = name === "org_structure" ? structuredClone(org) : {};
      refs.set(key, { key, id: name, exists: true, data });
    }
    return refs.get(key);
  }

  Object.entries(therapists || {}).forEach(([id, data]) => {
    const key = `${brandId}:therapists:${id}`;
    refs.set(key, { key, id, exists: true, data: structuredClone(data) });
  });

  function collectionRef(b, name) {
    return {
      doc(id) {
        const docId = id || `auto_${++generated}`;
        const key = `${b}:${name}:${docId}`;
        if (!refs.has(key)) refs.set(key, { key, id: docId, exists: false, data: {} });
        return refs.get(key);
      },
    };
  }

  const db = {
    async runTransaction(callback) {
      transactionCount += 1;
      const tx = {
        async get(ref) {
          return {
            exists: ref.exists,
            id: ref.id,
            data: () => structuredClone(ref.data || {}),
          };
        },
        set(ref, data, options = {}) {
          const cloned = structuredClone(data);
          writes.push({ key: ref.key, data: cloned, options });
          ref.data = options.merge
            ? { ...(ref.data || {}), ...cloned }
            : cloned;
          ref.exists = true;
        },
        delete(ref) {
          deletes.push(ref.key);
          ref.data = {};
          ref.exists = false;
        },
      };
      return callback(tx);
    },
  };

  const fakeOnRequest = (options, handler) => {
    handler.options = options;
    return handler;
  };

  const assertAdminApplicationClaims = (auth, requestedBrand, actor, verified = {}) => {
    const decoded = auth?.decoded || {};
    const actorId = String(actor?.accountId || "");
    const verifiedId = String(verified?.actorAccountId || actorId);
    if (
      decoded.drcyjIdentity !== true ||
      decoded.identityVersion !== "application-identity-v1" ||
      decoded.brandId !== requestedBrand ||
      decoded.roleId !== "director" ||
      String(decoded.accountId || "") !== actorId ||
      !actorId ||
      verifiedId !== actorId
    ) {
      const error = new Error("admin_application_identity_mismatch");
      error.code = "admin_application_identity_mismatch";
      error.status = 403;
      throw error;
    }
  };

  const factory = createTherapistMasterAuthorityFunctions({
    onRequest: fakeOnRequest,
    db,
    runtimeServiceAccount: "drcyj-account-authority@cyjsituation-analysis.iam.gserviceaccount.com",
    normalizeBrandId: (value) => {
      const v = String(value || "").trim().toLowerCase();
      return ["cyj", "anniu", "yibo"].includes(v) ? v : "cyj";
    },
    getBrandSettingDoc: (_db, b, name) => settingRef(b, name),
    getBrandCollection: (_db, b, name) => collectionRef(b, name),
    requireFirebaseRequestAuth: async () => requestAuth || ({
      ok: true,
      decoded: {
        drcyjIdentity: true,
        identityVersion: "application-identity-v1",
        brandId,
        roleId: "director",
        accountId: "boss",
      },
    }),
    verifySuperAdminActor: async () => adminCheck || ({
      ok: true,
      actorName: "Boss",
      actorRole: "director",
      actorAccountId: "boss",
      directorLevel: "super_admin",
      isMasterCredential: false,
    }),
    assertAdminApplicationClaims,
    normalizeStoreCore,
    getInitialPasswordsForRole: () => ["0000"],
    serverTimestamp: () => ({ __serverTimestamp: true }),
  });

  const call = async (body = {}) => {
    const res = makeResponse();
    const action = body.action || "update";
    let requestBody = {
      brandId,
      actor: {
        roleId: "director",
        accountId: "boss",
        deviceId: "dev-1",
        credentialPassword: "boss-secret",
      },
      ...body,
    };
    if (
      action !== "create" &&
      !Object.prototype.hasOwnProperty.call(requestBody, "expectedMasterSignature")
    ) {
      const therapistId = String(requestBody.therapistId || requestBody.accountId || "t1");
      const ref = refs.get(`${brandId}:therapists:${therapistId}`);
      if (ref?.exists) requestBody.expectedMasterSignature = buildTherapistMasterSignature(ref.data);
    }
    await factory.manageTherapistMaster({
      method: "POST",
      headers: { authorization: "Bearer token" },
      body: requestBody,
    }, res);
    return res;
  };

  return {
    refs,
    writes,
    deletes,
    call,
    settingRef,
    collectionRef,
    get transactionCount() { return transactionCount; },
  };
}

test("B1C1B3 is backend-only shadow master authority on the existing Account Authority runtime", () => {
  assert.equal(THERAPIST_MASTER_AUTHORITY_VERSION, "therapist-master-authority-v1");
  assert.match(functionsIndex, /exports\.manageTherapistMaster\s*=\s*therapistMasterAuthorityFunctions\.manageTherapistMaster/);
  assert.match(functionsIndex, /runtimeServiceAccount:\s*ACCOUNT_AUTHORITY_RUNTIME_SERVICE_ACCOUNT/);
  assert.match(functionsIndex, /normalizeStoreCore:\s*normalizeStoreLifecycleCore/);
  assert.doesNotMatch(app, /manageTherapistMaster/);
  assert.doesNotMatch(managerView, /manageTherapistMaster/);
  assert.doesNotMatch(settings, /manageTherapistMaster/);
  assert.match(app, /CURRENT_APP_VERSION\s*=\s*"3\.6\.0"/);
  assert.doesNotMatch(rules, /request\.auth\.token\.drcyjIdentity/);
});

test("therapist master authority rejects unknown brand before a transaction", async () => {
  const env = makeEnv();
  const res = await env.call({ brandId: "unknown", action: "create", payload: { name: "測試", store: "A" } });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, "invalid_brand");
  assert.equal(env.transactionCount, 0);
});

test("therapist master authority requires server-issued director identity before super-admin mutation", async () => {
  const env = makeEnv({
    requestAuth: { ok: true, decoded: { firebase: { sign_in_provider: "anonymous" } } },
  });
  const res = await env.call({ action: "archive", therapistId: "t1" });
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, "admin_application_identity_mismatch");
  assert.equal(env.transactionCount, 0);
});

test("master semantic signature excludes credential churn but detects stale master intent", async () => {
  const base = {
    id: "t1",
    name: "王小美",
    store: "A",
    password: "old-secret",
    status: "在職",
    isActive: true,
    isResigned: false,
  };
  assert.equal(
    buildTherapistMasterSignature(base),
    buildTherapistMasterSignature({ ...base, password: "new-secret", updatedAtText: "later" })
  );

  const env = makeEnv();
  const res = await env.call({
    action: "update",
    therapistId: "t1",
    payload: { name: "王小美2" },
    expectedMasterSignature: "stale-signature",
  });
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, "therapist_master_conflict");
  assert.match(res.body.currentMasterSignature, /^[a-f0-9]{64}$/);
  assert.equal(env.writes.length, 0);
});

test("create uses server initial credential, validates organization store, and never returns password material", async () => {
  const env = makeEnv();
  const rejected = await env.call({
    action: "create",
    payload: { name: "新管理師", store: "CYJ新店店", password: "admin-picked-secret" },
  });
  assert.equal(rejected.statusCode, 400);
  assert.equal(rejected.body.code, "credential_payload_not_allowed");
  assert.equal(env.transactionCount, 0);

  const res = await env.call({
    action: "create",
    payload: {
      name: "新管理師",
      store: "CYJ新店店",
      onboardDate: "2026-09-12",
    },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.requiresInitialPasswordChange, true);
  assert.equal(res.body.therapist.store, "新店");
  assert.equal(res.body.therapist.manager, "北區");
  assert.equal(Object.prototype.hasOwnProperty.call(res.body.therapist, "password"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(res.body, "password"), false);

  const created = [...env.refs.values()].find((ref) => ref.key.startsWith("cyj:therapists:auto_") && ref.exists);
  assert.ok(created);
  assert.equal(created.data.password, "0000");
  assert.equal(created.data.name, "新管理師");
  assert.equal(created.data.store, "新店");
  assert.equal(created.data.manager, "北區");

  const audit = env.writes.find((row) => row.key.includes(":system_logs:"));
  assert.ok(audit);
  assert.doesNotMatch(JSON.stringify(audit.data), /0000|admin-picked-secret|boss-secret|credentialPassword/);
});

test("update preserves fresh credential and unrelated operational fields while refreshing store ownership", async () => {
  const env = makeEnv();
  const res = await env.call({
    action: "update",
    therapistId: "t1",
    payload: {
      name: "王小美改",
      store: "CYJC店",
      onboardDate: "2026-01-10",
      resignDate: "",
    },
  });
  assert.equal(res.statusCode, 200);
  const ref = env.refs.get("cyj:therapists:t1");
  assert.equal(ref.data.name, "王小美改");
  assert.equal(ref.data.store, "C");
  assert.equal(ref.data.storeName, "C");
  assert.deepEqual(ref.data.stores, ["C"]);
  assert.equal(ref.data.manager, "南區");
  assert.equal(ref.data.password, "member-secret");
  assert.equal(ref.data.legacyTarget, 123);
  assert.equal(ref.data.status, "在職");
  assert.equal(ref.data.isActive, true);

  const masterWrite = env.writes.find((row) => row.key === "cyj:therapists:t1");
  assert.equal(masterWrite.options.merge, true);
  assert.equal(Object.prototype.hasOwnProperty.call(masterWrite.data, "password"), false);
});

test("archive preserves credential and writes one canonical inactive state", async () => {
  const env = makeEnv();
  const res = await env.call({
    action: "archive",
    therapistId: "t1",
    payload: { resignDate: "2026-09-12" },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.archived, true);
  const ref = env.refs.get("cyj:therapists:t1");
  assert.equal(ref.data.password, "member-secret");
  assert.equal(ref.data.status, "離職");
  assert.equal(ref.data.isActive, false);
  assert.equal(ref.data.isResigned, true);
  assert.equal(ref.data.resigned, true);
  assert.equal(ref.data.resignDate, "2026-09-12");
});

test("restore clears legacy inactive markers and revalidates the therapist store against current organization", async () => {
  const env = makeEnv({
    therapists: {
      t1: {
        id: "t1",
        name: "王小美",
        store: "A",
        storeName: "A",
        password: "member-secret",
        onboardDate: "2026-01-10",
        resignDate: "2026-08-20",
        inactiveDate: "2026-08-20",
        offboardDate: "2026-08-20",
        status: "resigned",
        isActive: false,
        isResigned: true,
        resigned: true,
      },
    },
  });
  const res = await env.call({ action: "restore", therapistId: "t1", payload: {} });
  assert.equal(res.statusCode, 200);
  const ref = env.refs.get("cyj:therapists:t1");
  assert.equal(ref.data.password, "member-secret");
  assert.equal(ref.data.status, "在職");
  assert.equal(ref.data.isActive, true);
  assert.equal(ref.data.isResigned, false);
  assert.equal(ref.data.resigned, false);
  assert.equal(ref.data.resignDate, "");
  assert.equal(ref.data.inactiveDate, "");
  assert.equal(ref.data.offboardDate, "");
  assert.equal(ref.data.manager, "北區");
});

test("permanent delete is explicit and requires archived state", async () => {
  const activeEnv = makeEnv();
  const activeDelete = await activeEnv.call({
    action: "delete",
    therapistId: "t1",
    payload: {},
    confirmPermanentDelete: true,
  });
  assert.equal(activeDelete.statusCode, 409);
  assert.equal(activeDelete.body.code, "archive_before_delete_required");
  assert.equal(activeEnv.deletes.length, 0);

  const archivedEnv = makeEnv({
    therapists: {
      t1: {
        id: "t1",
        name: "已離職",
        store: "A",
        password: "private-secret",
        onboardDate: "2025-01-01",
        resignDate: "2026-01-01",
        status: "離職",
        isActive: false,
        isResigned: true,
        resigned: true,
      },
    },
  });
  const noConfirm = await archivedEnv.call({
    action: "delete",
    therapistId: "t1",
    payload: {},
    confirmPermanentDelete: false,
  });
  assert.equal(noConfirm.statusCode, 400);
  assert.equal(noConfirm.body.code, "permanent_delete_confirmation_required");
  assert.equal(archivedEnv.deletes.length, 0);

  const confirmedEnv = makeEnv({
    therapists: {
      t1: {
        id: "t1",
        name: "已離職",
        store: "A",
        password: "private-secret",
        onboardDate: "2025-01-01",
        resignDate: "2026-01-01",
        status: "離職",
        isActive: false,
        isResigned: true,
        resigned: true,
      },
    },
  });
  const confirmed = await confirmedEnv.call({
    action: "delete",
    therapistId: "t1",
    payload: {},
    confirmPermanentDelete: true,
  });
  assert.equal(confirmed.statusCode, 200);
  assert.equal(confirmed.body.deleted, true);
  assert.deepEqual(confirmedEnv.deletes, ["cyj:therapists:t1"]);
  const audit = confirmedEnv.writes.find((row) => row.key.includes(":system_logs:"));
  assert.ok(audit);
  assert.doesNotMatch(JSON.stringify(audit.data), /private-secret|boss-secret|credentialPassword/);
});

test("invalid or cross-brand store scope fails closed and brand resolver keeps yibo isolated", async () => {
  const cyjEnv = makeEnv();
  const missing = await cyjEnv.call({
    action: "update",
    therapistId: "t1",
    payload: { store: "不存在店" },
  });
  assert.equal(missing.statusCode, 400);
  assert.equal(missing.body.code, "store_outside_brand_organization");

  const yiboEnv = makeEnv({
    brandId: "yibo",
    org: {
      managers: {
        一區: ["伊啵站前店"],
        未分配: ["伊啵新莊店"],
      },
      managerOrder: ["一區", "未分配"],
    },
    therapists: {},
  });
  const created = await yiboEnv.call({
    action: "create",
    payload: { name: "伊啵管理師", store: "伊啵站前店", onboardDate: "2026-09-12" },
  });
  assert.equal(created.statusCode, 200);
  assert.ok([...yiboEnv.refs.keys()].some((key) => key.startsWith("yibo:therapists:auto_")));
  assert.equal(yiboEnv.refs.has("cyj:settings:org_structure"), false);
});

test("master update does not accept arbitrary fields or mutate credential from admin payload", () => {
  assert.throws(() => applyTherapistMasterAction({
    action: "update",
    therapistId: "t1",
    payload: { target: 999 },
    currentRaw: {
      id: "t1",
      name: "王小美",
      store: "A",
      password: "member-secret",
      status: "在職",
      isActive: true,
    },
    organizationRaw: { managers: { 北區: ["CYJA店"] } },
    brandId: "cyj",
    nowText: "2026-09-12T00:00:00.000Z",
    todayText: "2026-09-12",
    normalizeStoreCore,
    getInitialPasswordsForRole: () => ["0000"],
    serverTimestamp: () => ({ __serverTimestamp: true }),
  }), /unsupported_master_field/);

  assert.throws(() => applyTherapistMasterAction({
    action: "update",
    therapistId: "t1",
    payload: { password: "admin-secret" },
    currentRaw: {
      id: "t1",
      name: "王小美",
      store: "A",
      password: "member-secret",
      status: "在職",
      isActive: true,
    },
    organizationRaw: { managers: { 北區: ["CYJA店"] } },
    brandId: "cyj",
    nowText: "2026-09-12T00:00:00.000Z",
    todayText: "2026-09-12",
    normalizeStoreCore,
    getInitialPasswordsForRole: () => ["0000"],
    serverTimestamp: () => ({ __serverTimestamp: true }),
  }), /credential_payload_not_allowed/);
});

test("B1C2B therapist master provisions only the legacy authority until explicit atomic migration", () => {
  assert.match(backendSource, /buildEmbeddedCredentialCreateFields\(initialPassword\)/);
  assert.match(backendSource, /credentialStorageMode:\s*result\.credentialStorageMode/);
  assert.match(backendSource, /deleteSeparatedTherapistCredentialInTransaction/);
  assert.doesNotMatch(backendSource, /onSnapshot|setInterval|setTimeout/);
  assert.match(backendSource, /transaction\.set\(therapistRef,\s*result\.next,\s*\{\s*merge:\s*true\s*\}\)/s);
  assert.match(backendSource, /semantic master signature intentionally excludes password/);
});

test("permanent delete removes a separated credential document in the same therapist master transaction", async () => {
  const env = makeEnv({
    therapists: {
      t1: {
        id: "t1",
        name: "已離職",
        store: "A",
        onboardDate: "2025-01-01",
        resignDate: "2026-01-01",
        status: "離職",
        isActive: false,
        isResigned: true,
        resigned: true,
        credentialStorageMode: "separated_v1",
      },
    },
  });
  const credentialRef = env.collectionRef("cyj", "therapist_credentials").doc("t1");
  credentialRef.exists = true;
  credentialRef.data = {
    schemaVersion: "therapist-credential-v1",
    brandId: "cyj",
    therapistId: "t1",
    password: "private-secret",
  };

  const res = await env.call({
    action: "delete",
    therapistId: "t1",
    payload: {},
    confirmPermanentDelete: true,
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.deleted, true);
  assert.ok(env.deletes.includes("cyj:therapist_credentials:t1"));
  assert.ok(env.deletes.includes("cyj:therapists:t1"));
});

test("therapist credential collection is protected now while raw therapist master lockdown remains later", () => {
  assert.match(rules, /match \/brands\/\{brandId\}\/therapist_credentials\/\{document=\*\*\}/);
  assert.match(rules, /match \/artifacts\/\{appId\}\/public\/data\/therapist_credentials\/\{document=\*\*\}/);
  assert.equal((rules.match(/collectionName != 'therapist_credentials'/g) || []).length, 2);
  assert.match(managerView, /String\(t\?\.password \|\| ""\)/);
  assert.match(app, /getDocs\(getCollectionPath\("therapists"\)\)/);
});

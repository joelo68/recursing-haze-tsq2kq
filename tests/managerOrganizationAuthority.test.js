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
  MANAGER_ORGANIZATION_AUTHORITY_VERSION,
  createManagerOrganizationAuthorityFunctions,
  buildManagerOrganizationSignature,
  applyManagerOrganizationAction,
} = require("../functions/managerOrganizationAuthority");

const functionsIndex = read("functions/index.js");
const app = read("src/App.jsx");
const settings = read("src/components/SettingsView.jsx");
const rules = read("firestore.rules");

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
      北區: ["CYJA店", "CYJB店"],
      南區: ["CYJC店"],
      未分配: ["CYJ新店店", "CYJD店"],
    },
    managerOrder: ["北區", "南區", "未分配"],
  },
  managerAuth = { 北區: "north-secret", 南區: "south-secret" },
  requestAuth,
  adminCheck,
} = {}) {
  const refs = new Map();
  const writes = [];
  let generated = 0;
  let transactionCount = 0;

  function settingRef(b, name) {
    const key = `${b}:settings:${name}`;
    if (!refs.has(key)) {
      const data = name === "org_structure"
        ? structuredClone(org)
        : name === "manager_auth"
          ? structuredClone(managerAuth)
          : {};
      refs.set(key, { key, exists: true, data });
    }
    return refs.get(key);
  }

  function collectionRef(b, name) {
    return {
      doc(id) {
        const docId = id || `auto_${++generated}`;
        const key = `${b}:${name}:${docId}`;
        if (!refs.has(key)) refs.set(key, { key, exists: false, data: {} });
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

  const factory = createManagerOrganizationAuthorityFunctions({
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
  });

  const call = async (body = {}) => {
    const res = makeResponse();
    const currentOrg = settingRef(brandId, "org_structure").data;
    const expected = Object.prototype.hasOwnProperty.call(body, "expectedOrganizationSignature")
      ? body.expectedOrganizationSignature
      : buildManagerOrganizationSignature(currentOrg);
    await factory.manageManagerOrganization({
      method: "POST",
      headers: { authorization: "Bearer token" },
      body: {
        brandId,
        actor: {
          roleId: "director",
          accountId: "boss",
          deviceId: "dev-1",
          credentialPassword: "secret",
        },
        expectedOrganizationSignature: expected,
        ...body,
      },
    }, res);
    return res;
  };

  return {
    refs,
    writes,
    call,
    settingRef,
    get transactionCount() { return transactionCount; },
  };
}

test("B1C1B2 is backend-only shadow authority on the existing Account Authority runtime", () => {
  assert.equal(MANAGER_ORGANIZATION_AUTHORITY_VERSION, "manager-organization-authority-v1");
  assert.match(functionsIndex, /exports\.manageManagerOrganization\s*=\s*managerOrganizationAuthorityFunctions\.manageManagerOrganization/);
  assert.match(functionsIndex, /runtimeServiceAccount:\s*ACCOUNT_AUTHORITY_RUNTIME_SERVICE_ACCOUNT/);
  assert.match(functionsIndex, /normalizeStoreCore:\s*normalizeStoreLifecycleCore/);
  assert.doesNotMatch(app, /manageManagerOrganization/);
  assert.doesNotMatch(settings, /manageManagerOrganization/);
  assert.match(app, /CURRENT_APP_VERSION\s*=\s*"3\.6\.0"/);
  assert.doesNotMatch(rules, /request\.auth\.token\.drcyjIdentity/);
});

test("manager organization authority rejects unknown brand before a transaction", async () => {
  const env = makeEnv();
  const res = await env.call({ brandId: "unknown", action: "create", payload: { name: "新區" } });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, "invalid_brand");
  assert.equal(env.transactionCount, 0);
});

test("manager organization authority requires server-issued director identity before super-admin mutation", async () => {
  const env = makeEnv({
    requestAuth: { ok: true, decoded: { firebase: { sign_in_provider: "anonymous" } } },
  });
  const res = await env.call({ action: "create", payload: { name: "新區" } });
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, "admin_application_identity_mismatch");
  assert.equal(env.transactionCount, 0);
});

test("semantic signature OCC detects stale organization intent without adding an org revision schema", async () => {
  const env = makeEnv();
  const res = await env.call({
    action: "create",
    payload: { name: "新區" },
    expectedOrganizationSignature: "stale-signature",
  });
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, "organization_conflict");
  assert.match(res.body.currentOrganizationSignature, /^[a-f0-9]{64}$/);
  assert.equal(env.writes.length, 0);
  const org = env.settingRef("cyj", "org_structure").data;
  assert.equal(Object.prototype.hasOwnProperty.call(org, "revision"), false);
});

test("create manager writes org_structure and manager_auth atomically with server initial password", async () => {
  const env = makeEnv();
  const res = await env.call({ action: "create", payload: { name: "東區", password: "admin-picked-secret" } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.managerName, "東區");
  assert.equal(res.body.requiresInitialPasswordChange, true);
  assert.equal(Object.prototype.hasOwnProperty.call(res.body, "password"), false);

  const org = env.settingRef("cyj", "org_structure").data;
  const auth = env.settingRef("cyj", "manager_auth").data;
  assert.deepEqual(org.managers["東區"], []);
  assert.deepEqual(org.managerOrder, ["北區", "南區", "東區", "未分配"]);
  assert.equal(auth["東區"], "0000");
  assert.notEqual(auth["東區"], "admin-picked-secret");

  const snapshot = env.writes.find((row) => row.key.includes(":org_structure_snapshots:"));
  const audit = env.writes.find((row) => row.key.includes(":system_logs:"));
  assert.ok(snapshot);
  assert.ok(audit);
  assert.doesNotMatch(JSON.stringify(snapshot.data), /admin-picked-secret|credentialPassword/);
  assert.doesNotMatch(JSON.stringify(audit.data), /admin-picked-secret|credentialPassword/);
});

test("update rename preserves credential, updates managerOrder, and releases removed stores to 未分配", async () => {
  const env = makeEnv({
    managerAuth: {
      北區: { password: "north-secret", name: "北區", id: "北區", custom: "keep" },
      南區: "south-secret",
    },
  });
  const res = await env.call({
    action: "update",
    managerName: "北區",
    payload: { name: "北一區", stores: ["CYJA店", "CYJ新店"] },
  });
  assert.equal(res.statusCode, 200);

  const org = env.settingRef("cyj", "org_structure").data;
  const auth = env.settingRef("cyj", "manager_auth").data;
  assert.equal(Object.prototype.hasOwnProperty.call(org.managers, "北區"), false);
  assert.deepEqual(org.managers["北一區"], ["CYJA店", "CYJ新店店"]);
  assert.ok(org.managers["未分配"].includes("CYJB店"));
  assert.ok(org.managers["未分配"].includes("CYJD店"));
  assert.equal(org.managers["未分配"].includes("CYJ新店店"), false);
  assert.deepEqual(org.managerOrder, ["北一區", "南區", "未分配"]);

  assert.equal(Object.prototype.hasOwnProperty.call(auth, "北區"), false);
  assert.equal(auth["北一區"].password, "north-secret");
  assert.equal(auth["北一區"].name, "北一區");
  assert.equal(auth["北一區"].id, "北一區");
  assert.equal(auth["北一區"].custom, "keep");
});

test("update refuses to silently steal a store from another manager", async () => {
  const env = makeEnv();
  const res = await env.call({
    action: "update",
    managerName: "北區",
    payload: { name: "北區", stores: ["CYJA店", "CYJC店"] },
  });
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, "store_owned_by_other_manager");
  assert.equal(env.writes.length, 0);
});

test("delete manager moves all stores to 未分配, removes credential and stable order entry", async () => {
  const env = makeEnv();
  const res = await env.call({ action: "delete", managerName: "南區" });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.deleted, true);
  assert.equal(res.body.releasedStoreCount, 1);

  const org = env.settingRef("cyj", "org_structure").data;
  const auth = env.settingRef("cyj", "manager_auth").data;
  assert.equal(Object.prototype.hasOwnProperty.call(org.managers, "南區"), false);
  assert.ok(org.managers["未分配"].includes("CYJC店"));
  assert.deepEqual(org.managerOrder, ["北區", "未分配"]);
  assert.equal(Object.prototype.hasOwnProperty.call(auth, "南區"), false);
});

test("existing duplicate store ownership fails closed instead of being silently repaired", async () => {
  const env = makeEnv({
    org: {
      managers: {
        北區: ["CYJA店"],
        南區: ["A店"],
        未分配: [],
      },
      managerOrder: ["北區", "南區", "未分配"],
    },
  });
  const res = await env.call({ action: "delete", managerName: "南區" });
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, "organization_duplicate_store");
  assert.equal(env.writes.length, 0);
});

test("brand path is resolver-driven and yibo stays isolated from CYJ", async () => {
  const env = makeEnv({
    brandId: "yibo",
    org: {
      managers: { 一區: ["伊啵站前店"], 未分配: ["伊啵新莊店"] },
      managerOrder: ["一區", "未分配"],
    },
    managerAuth: { 一區: "secret" },
  });
  const res = await env.call({ action: "create", payload: { name: "二區" } });
  assert.equal(res.statusCode, 200);
  assert.equal(env.settingRef("yibo", "manager_auth").data["二區"], "0000");
  assert.equal(env.refs.has("cyj:settings:org_structure"), false);
});

test("pure action does not mutate unrelated credential material or accept raw password from admin payload", () => {
  const result = applyManagerOrganizationAction({
    action: "create",
    targetManagerName: "",
    payload: { name: "東區", password: "should-not-be-used" },
    organizationRaw: {
      managers: { 北區: ["A店"], 未分配: ["B店"] },
      managerOrder: ["北區", "未分配"],
      unrelated: "preserved-by-transaction-wrapper",
    },
    managerAuthRaw: { 北區: "private" },
    brandId: "cyj",
    nowText: "2026-09-12T00:00:00.000Z",
    normalizeStoreCore,
    getInitialPasswordsForRole: () => ["0000"],
  });
  assert.equal(result.managerAuth["東區"], "0000");
  assert.equal(result.managerAuth["北區"], "private");
  assert.notEqual(result.managerAuth["東區"], "should-not-be-used");
});

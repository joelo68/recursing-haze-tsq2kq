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
  MANAGEMENT_DELEGATION_AUTHORITY_VERSION,
  createManagementDelegationAuthorityFunctions,
  buildDelegationSemanticSignature,
} = require("../functions/managementDelegationAuthority");

const functionsIndex = read("functions/index.js");
const app = read("src/App.jsx");
const settings = read("src/components/SettingsView.jsx");
const rules = read("firestore.rules");

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
      未分配: ["CYJ新店店"],
    },
    managerOrder: ["北區", "南區", "未分配"],
  },
  storeAccounts = {
    accounts: [
      { id: "store-a", name: "A店經", stores: ["CYJA店"] },
      { id: "store-b", name: "B店經", stores: ["CYJB店"] },
      { id: "store-c", name: "C店經", stores: ["CYJC店"] },
    ],
  },
  requestAuth,
  adminCheck,
} = {}) {
  const refs = new Map();
  const writes = [];
  let generated = 0;
  let transactionCount = 0;

  function ensureRef(key, data = {}, exists = false, meta = {}) {
    if (!refs.has(key)) refs.set(key, { key, exists, data: structuredClone(data), ...meta });
    return refs.get(key);
  }

  function settingRef(b, name) {
    const key = `${b}:settings:${name}`;
    if (name === "org_structure") return ensureRef(key, org, true, { brandId: b, collectionName: "settings", id: name });
    if (name === "store_account_data") return ensureRef(key, storeAccounts, true, { brandId: b, collectionName: "settings", id: name });
    return ensureRef(key, {}, false, { brandId: b, collectionName: "settings", id: name });
  }

  function collectionRef(b, name) {
    return {
      brandId: b,
      collectionName: name,
      doc(id) {
        const docId = id || `auto_${++generated}`;
        const key = `${b}:${name}:${docId}`;
        return ensureRef(key, {}, false, { brandId: b, collectionName: name, id: docId });
      },
      where(field, op, values) {
        return { kind: "query", brandId: b, collectionName: name, field, op, values };
      },
    };
  }

  function snapshotForRef(ref) {
    return {
      id: ref.id,
      exists: ref.exists,
      data: () => structuredClone(ref.data || {}),
    };
  }

  function querySnapshot(queryRef) {
    const docs = [...refs.values()]
      .filter((ref) => ref.collectionName === queryRef.collectionName && ref.brandId === queryRef.brandId && ref.exists)
      .filter((ref) => {
        if (queryRef.op !== "in") return true;
        return Array.isArray(queryRef.values) && queryRef.values.includes(ref.data?.[queryRef.field]);
      })
      .map(snapshotForRef);
    return { docs };
  }

  const db = {
    async runTransaction(callback) {
      transactionCount += 1;
      const tx = {
        async get(ref) {
          if (ref?.kind === "query") return querySnapshot(ref);
          return snapshotForRef(ref);
        },
        set(ref, data, options = {}) {
          const cloned = structuredClone(data);
          writes.push({ key: ref.key, data: cloned, options });
          ref.data = options.merge ? { ...(ref.data || {}), ...cloned } : cloned;
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

  const factory = createManagementDelegationAuthorityFunctions({
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
      actorUid: "uid-boss",
      directorLevel: "super_admin",
      isMasterCredential: false,
    }),
    assertAdminApplicationClaims,
    serverTimestamp: () => ({ __serverTimestamp: true }),
  });

  const call = async (body = {}) => {
    const res = makeResponse();
    await factory.manageManagementDelegation({
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
        ...body,
      },
    }, res);
    return res;
  };

  const getRefData = (b, collectionName, id) => {
    const ref = refs.get(`${b}:${collectionName}:${id}`);
    return ref?.exists ? structuredClone(ref.data) : null;
  };

  return {
    refs,
    writes,
    call,
    getRefData,
    get transactionCount() { return transactionCount; },
  };
}

const managerPayload = ({
  principal = "北區",
  delegate = "南區",
  stores = ["A"],
  startDate = "2026-09-24",
  endDate = "2026-10-05",
} = {}) => ({
  schemaVersion: "delegation-v1",
  type: "regional_manager",
  principalRole: "manager",
  principalId: principal,
  principalName: principal,
  delegateRole: "manager",
  delegateId: delegate,
  delegateName: delegate,
  scopeMode: "selected_stores",
  storeNames: stores,
  principalStoreSnapshot: ["A", "B"],
  startDate,
  endDate,
  status: "active",
  permissions: {
    viewOperations: true,
    editReports: true,
    editHistory: true,
    deleteReports: false,
    receiveAlerts: true,
    manageTasks: true,
    editTargets: false,
    editOrganization: false,
  },
  reason: "代理測試",
});

test("A2-2 registers a backend-only delegation writer without changing app version", () => {
  assert.equal(MANAGEMENT_DELEGATION_AUTHORITY_VERSION, "management-delegation-authority-v1");
  assert.match(functionsIndex, /exports\.manageManagementDelegation\s*=\s*managementDelegationAuthorityFunctions\.manageManagementDelegation/);
  assert.match(functionsIndex, /runtimeServiceAccount:\s*ACCOUNT_AUTHORITY_RUNTIME_SERVICE_ACCOUNT/);
  assert.match(app, /MANAGE_MANAGEMENT_DELEGATION_ENDPOINT/);
  assert.match(app, /const manageManagementDelegationAction = useCallback/);
  assert.match(settings, /manageManagementDelegationAction/);
  assert.match(app, /CURRENT_APP_VERSION\s*=\s*"3\.6\.0"/);
  assert.match(rules, /management_delegation_authority/);
});

test("authority rejects unsupported brand before transaction", async () => {
  const env = makeEnv();
  const res = await env.call({
    brandId: "unknown",
    action: "create",
    delegationId: "DLG-X",
    payload: managerPayload(),
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, "invalid_brand");
  assert.equal(env.transactionCount, 0);
});

test("authority requires server-issued director identity", async () => {
  const env = makeEnv({
    requestAuth: { ok: true, decoded: { firebase: { sign_in_provider: "anonymous" } } },
  });
  const res = await env.call({
    action: "create",
    delegationId: "DLG-X",
    payload: managerPayload(),
  });
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, "admin_application_identity_mismatch");
  assert.equal(env.transactionCount, 0);
});

test("create writes delegation + shared authority state + maintenance + system audit in one transaction", async () => {
  const env = makeEnv();
  const res = await env.call({
    action: "create",
    delegationId: "DLG-1",
    payload: managerPayload(),
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.delegationId, "DLG-1");
  assert.equal(res.body.authorityRevision, 1);

  const delegation = env.getRefData("cyj", "management_delegations", "DLG-1");
  assert.equal(delegation.schemaVersion, "delegation-v1");
  assert.equal(delegation.permissions.editOrganization, false);
  assert.deepEqual(delegation.storeNames, ["A"]);
  assert.deepEqual(delegation.principalStoreSnapshot, ["A", "B"]);

  const state = env.getRefData("cyj", "management_delegation_authority", "state");
  assert.equal(state.revision, 1);
  assert.equal(state.lastDelegationId, "DLG-1");

  assert.ok(env.writes.some((row) => row.key.includes(":maintenance_logs:")));
  assert.ok(env.writes.some((row) => row.key.includes(":system_logs:")));
  assert.doesNotMatch(JSON.stringify(env.writes), /credentialPassword|secret/);
});

test("different delegation IDs cannot overlap the same store and date range", async () => {
  const env = makeEnv();
  const first = await env.call({
    action: "create",
    delegationId: "DLG-1",
    payload: managerPayload({ stores: ["A"] }),
  });
  assert.equal(first.statusCode, 200);

  const second = await env.call({
    action: "create",
    delegationId: "DLG-2",
    payload: managerPayload({ delegate: "南區", stores: ["A"], startDate: "2026-09-25", endDate: "2026-09-30" }),
  });
  assert.equal(second.statusCode, 409);
  assert.equal(second.body.code, "delegation_overlap_conflict");
  assert.equal(second.body.conflictDelegationId, "DLG-1");
  assert.deepEqual(second.body.overlapStores, ["A"]);
});

test("update uses semantic snapshot OCC and rejects stale administrator intent", async () => {
  const env = makeEnv();
  const created = await env.call({
    action: "create",
    delegationId: "DLG-1",
    payload: managerPayload(),
  });
  assert.equal(created.statusCode, 200);

  const original = env.getRefData("cyj", "management_delegations", "DLG-1");
  const firstUpdate = await env.call({
    action: "update",
    delegationId: "DLG-1",
    expectedDelegation: original,
    payload: managerPayload({ endDate: "2026-10-10" }),
  });
  assert.equal(firstUpdate.statusCode, 200);

  const staleUpdate = await env.call({
    action: "update",
    delegationId: "DLG-1",
    expectedDelegation: original,
    payload: managerPayload({ endDate: "2026-10-12" }),
  });
  assert.equal(staleUpdate.statusCode, 409);
  assert.equal(staleUpdate.body.code, "delegation_conflict");
  assert.match(staleUpdate.body.currentDelegationSignature, /^[a-f0-9]{64}$/);
});

test("end is atomic, OCC protected, and an ended delegation cannot be ended twice", async () => {
  const env = makeEnv();
  const created = await env.call({
    action: "create",
    delegationId: "DLG-1",
    payload: managerPayload(),
  });
  assert.equal(created.statusCode, 200);

  const current = env.getRefData("cyj", "management_delegations", "DLG-1");
  const ended = await env.call({
    action: "end",
    delegationId: "DLG-1",
    expectedDelegation: current,
  });
  assert.equal(ended.statusCode, 200);
  const endedData = env.getRefData("cyj", "management_delegations", "DLG-1");
  assert.equal(endedData.status, "ended");
  assert.equal(endedData.endedEarly, true);
  assert.equal(endedData.endedByRole, "director");

  const second = await env.call({
    action: "end",
    delegationId: "DLG-1",
    expectedDelegation: endedData,
  });
  assert.equal(second.statusCode, 409);
  assert.equal(second.body.code, "delegation_already_ended");
});

test("store-manager delegation resolves against canonical store_account_data and blocks scope expansion", async () => {
  const env = makeEnv();
  const payload = {
    ...managerPayload(),
    type: "store_manager",
    principalRole: "store",
    principalId: "store-a",
    principalName: "A店經",
    delegateRole: "store",
    delegateId: "store-b",
    delegateName: "B店經",
    storeNames: ["C"],
  };
  const res = await env.call({
    action: "create",
    delegationId: "DLG-STORE",
    payload,
  });
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, "delegation_store_outside_principal_scope");
});

test("brand resolver keeps yibo writes isolated from CYJ", async () => {
  const env = makeEnv({
    brandId: "yibo",
    org: {
      managers: { 一區: ["伊啵站前店"], 二區: ["伊啵新莊店"], 未分配: [] },
      managerOrder: ["一區", "二區", "未分配"],
    },
    storeAccounts: {
      accounts: [
        { id: "y1", name: "站前店經", stores: ["伊啵站前店"] },
        { id: "y2", name: "新莊店經", stores: ["伊啵新莊店"] },
      ],
    },
  });
  const res = await env.call({
    action: "create",
    delegationId: "DLG-Y",
    payload: managerPayload({ principal: "一區", delegate: "二區", stores: ["站前"] }),
  });
  assert.equal(res.statusCode, 200);
  assert.ok(env.getRefData("yibo", "management_delegations", "DLG-Y"));
  assert.equal(env.getRefData("cyj", "management_delegations", "DLG-Y"), null);
});

test("semantic signature excludes Firestore timestamp objects but tracks business-state changes", () => {
  const base = {
    ...managerPayload(),
    updatedAt: { seconds: 1 },
    createdAt: { seconds: 1 },
    updatedAtText: "2026-09-24T00:00:00.000Z",
    createdAtText: "2026-09-24T00:00:00.000Z",
  };
  const a = buildDelegationSemanticSignature(base, "DLG-1");
  const b = buildDelegationSemanticSignature({
    ...base,
    updatedAt: { seconds: 999 },
    createdAt: { seconds: 999 },
  }, "DLG-1");
  assert.equal(a, b);

  const c = buildDelegationSemanticSignature({ ...base, endDate: "2026-10-06" }, "DLG-1");
  assert.notEqual(a, c);
});

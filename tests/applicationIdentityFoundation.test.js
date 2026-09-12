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
  APPLICATION_IDENTITY_VERSION,
  APPLICATION_DIRECTORY_VERSION,
  buildApplicationIdentityUid,
  buildVerifiedApplicationIdentity,
  buildSanitizedLoginDirectory,
  createApplicationIdentityFunctions,
} = require("../functions/applicationIdentity");

const backend = read("functions/deviceApproval.js");
const functionsIndex = read("functions/index.js");
const app = read("src/App.jsx");
const rules = read("firestore.rules");

test("P0-B1A builds deterministic server identity claims without password material", () => {
  const credential = {
    ok: true,
    accountId: "director-001",
    userName: "測試主管",
    directorLevel: "super_admin",
    isMasterCredential: false,
  };

  const first = buildVerifiedApplicationIdentity({
    brandId: "cyj",
    roleId: "director",
    requestedAccountId: "director-001",
    credential,
  });
  const second = buildVerifiedApplicationIdentity({
    brandId: "cyj",
    roleId: "director",
    requestedAccountId: "director-001",
    credential,
  });

  assert.equal(first.identity.version, APPLICATION_IDENTITY_VERSION);
  assert.equal(first.identity.brandId, "cyj");
  assert.equal(first.identity.roleId, "director");
  assert.equal(first.identity.accountId, "director-001");
  assert.equal(first.identity.directorLevel, "super_admin");
  assert.equal(first.uid, second.uid);
  assert.equal(first.uid, buildApplicationIdentityUid({
    brandId: "cyj",
    roleId: "director",
    accountId: "director-001",
  }));
  assert.equal(first.claims.drcyjIdentity, true);
  assert.equal(first.claims.identityVersion, APPLICATION_IDENTITY_VERSION);
  assert.equal(first.claims.brandId, "cyj");
  assert.equal(first.claims.roleId, "director");
  assert.equal(first.claims.accountId, "director-001");
  assert.equal(first.claims.directorLevel, "super_admin");
  assert.equal(Object.prototype.hasOwnProperty.call(first.claims, "isMasterCredential"), false);

  const serialized = JSON.stringify(first);
  assert.doesNotMatch(serialized, /password/i);
  assert.doesNotMatch(serialized, /BOSS888|0000/);
});

test("sanitized login directory preserves login selectors but strips every password source", () => {
  const directory = buildSanitizedLoginDirectory({
    brandId: "anniu",
    directorAuth: {
      accounts: {
        boss: { id: "boss", name: "董事長", password: "director-secret", level: "super_admin", isActive: true },
        finance: { id: "finance", name: "財務主管", password: "finance-secret", level: "finance_admin", isActive: true },
      },
      directorOrder: ["boss", "finance"],
      password: "legacy-director-secret",
    },
    trainerAuth: {
      accounts: {
        trainerA: { id: "trainerA", name: "教專 A", password: "trainer-secret", isActive: true },
      },
      trainerOrder: ["trainerA"],
      password: "legacy-trainer-secret",
    },
    managerAuth: {
      "北區長": "manager-secret",
      "南區長": { password: "manager-secret-2", isActive: true },
    },
    storeAccountData: {
      accounts: [
        { id: "store-1", name: "店經理 A", password: "store-secret", stores: ["台北店"] },
      ],
    },
    therapists: [
      {
        id: "therapist-1",
        data: {
          id: "therapist-1",
          name: "管理師 A",
          password: "therapist-secret",
          storeName: "台北店",
          status: "active",
          isActive: true,
        },
      },
    ],
  });

  assert.equal(directory.version, APPLICATION_DIRECTORY_VERSION);
  assert.equal(directory.brandId, "anniu");
  assert.equal(directory.directors.length, 2);
  assert.equal(directory.trainers.length, 1);
  assert.equal(directory.managers.length, 2);
  assert.equal(directory.stores.length, 1);
  assert.equal(directory.therapists.length, 1);
  assert.equal(directory.directors[0].level, "super_admin");
  assert.deepEqual(directory.stores[0].stores, ["台北店"]);
  assert.equal(directory.therapists[0].storeName, "台北店");

  const serialized = JSON.stringify(directory);
  for (const secret of [
    "director-secret",
    "finance-secret",
    "legacy-director-secret",
    "trainer-secret",
    "legacy-trainer-secret",
    "manager-secret",
    "manager-secret-2",
    "store-secret",
    "therapist-secret",
  ]) {
    assert.doesNotMatch(serialized, new RegExp(secret));
  }
  assert.doesNotMatch(serialized, /"password"\s*:/i);
});

test("directory endpoint requires Firebase auth and reads only the five minimal account sources", async () => {
  const reads = [];
  const dataBySetting = {
    store_account_data: { accounts: [{ id: "s1", name: "店經理", password: "secret", stores: ["A店"] }] },
    manager_auth: { "區長 A": "secret" },
    trainer_auth: { accounts: { t1: { id: "t1", name: "教專", password: "secret" } }, trainerOrder: ["t1"] },
    director_auth: { accounts: { d1: { id: "d1", name: "主管", password: "secret", level: "operation_admin" } }, directorOrder: ["d1"] },
  };

  const docSnap = (data) => ({
    exists: true,
    data: () => data,
  });
  const therapistSnap = {
    docs: [{
      id: "th1",
      data: () => ({ name: "管理師", password: "secret", store: "A店", isActive: true }),
    }],
  };

  const fakeOnRequest = (_options, handler) => handler;
  const factory = (authOk = true) => createApplicationIdentityFunctions({
    onRequest: fakeOnRequest,
    db: {},
    normalizeBrandId: (value) => String(value || "cyj").toLowerCase(),
    getBrandSettingDoc: (_db, brandId, name) => ({
      get: async () => {
        reads.push(`setting:${brandId}:${name}`);
        return docSnap(dataBySetting[name] || {});
      },
    }),
    getBrandCollection: (_db, brandId, name) => ({
      get: async () => {
        reads.push(`collection:${brandId}:${name}`);
        return therapistSnap;
      },
    }),
    requireFirebaseRequestAuth: async () => ({ ok: authOk, uid: authOk ? "anon-uid" : "" }),
  });

  const unauthorized = factory(false).getApplicationLoginDirectory;
  let unauthorizedStatus = 200;
  let unauthorizedBody = null;
  await unauthorized(
    { method: "POST", body: { brandId: "cyj" } },
    {
      set() {},
      status(code) { unauthorizedStatus = code; return this; },
      json(body) { unauthorizedBody = body; return body; },
    }
  );
  assert.equal(unauthorizedStatus, 401);
  assert.equal(unauthorizedBody.ok, false);

  reads.length = 0;
  const handler = factory(true).getApplicationLoginDirectory;
  let statusCode = 0;
  let responseBody = null;
  let cacheControl = "";
  await handler(
    { method: "POST", body: { brandId: "cyj" } },
    {
      set(name, value) { if (name === "Cache-Control") cacheControl = value; },
      status(code) { statusCode = code; return this; },
      json(body) { responseBody = body; return body; },
    }
  );

  assert.equal(statusCode, 200);
  assert.equal(responseBody.ok, true);
  assert.equal(responseBody.directory.brandId, "cyj");
  assert.equal(cacheControl, "private, no-store");
  assert.deepEqual(reads.sort(), [
    "collection:cyj:therapists",
    "setting:cyj:director_auth",
    "setting:cyj:manager_auth",
    "setting:cyj:store_account_data",
    "setting:cyj:trainer_auth",
  ].sort());
  assert.doesNotMatch(JSON.stringify(responseBody), /"password"\s*:/i);
  assert.doesNotMatch(JSON.stringify(responseBody), /secret/);
  assert.ok(!reads.some((item) => item.includes("master_auth")));
});

test("checkDeviceAccess mints an application custom token only after device policy allows the session", () => {
  assert.match(backend, /buildVerifiedApplicationIdentity/);
  assert.match(backend, /requestApplicationIdentityToken\s*=\s*body\.requestApplicationIdentityToken === true/);
  assert.match(backend, /const sessionEligible = payload\?\.allowed === true/);
  assert.match(backend, /if \(requestApplicationIdentityToken && sessionEligible\)/);
  assert.match(backend, /admin\.auth\(\)\.createCustomToken/);
  assert.match(backend, /application identity session token mint failed/);
  assert.match(backend, /code:\s*'application_identity_token_unavailable'/);
  assert.match(backend, /tokenRequested:\s*requestApplicationIdentityToken/);
  assert.match(backend, /tokenAvailable:\s*Boolean\(applicationIdentityCustomToken\)/);
  assert.match(backend, /sessionEligible,/);

  const mintStart = backend.indexOf("if (requestApplicationIdentityToken && sessionEligible)");
  const mintEnd = backend.indexOf("return res.status(status).json", mintStart);
  assert.ok(mintStart > 0 && mintEnd > mintStart);
  const mintBlock = backend.slice(mintStart, mintEnd);
  assert.match(mintBlock, /createCustomToken/);
});

test("B1C2C1 frontend consumes sanitized directory while application session cutover stays intact", () => {
  assert.match(functionsIndex, /createApplicationIdentityFunctions/);
  assert.match(functionsIndex, /exports\.getApplicationLoginDirectory\s*=\s*applicationIdentityFunctions\.getApplicationLoginDirectory/);
  assert.match(app, /LOGIN_DIRECTORY_ENDPOINT/);
  assert.match(app, /getApplicationLoginDirectory/);
  assert.match(app, /assertSanitizedLoginDirectory/);
  assert.match(app, /requestApplicationIdentityToken:\s*true/);
  assert.match(app, /signInWithCustomToken\(auth, customToken\)/);
  assert.match(app, /CURRENT_APP_VERSION\s*=\s*"3\.6\.0"/);
});

test("P0-B1A does not tighten Firestore Rules before frontend credential retirement", () => {
  assert.match(rules, /function signedIn\(\)\s*\{\s*return request\.auth != null;/);
  assert.match(rules, /match \/brands\/\{brandId\}\/\{collectionName\}\/\{document=\*\*\}/);
  assert.match(rules, /allow read, write:\s*if signedIn\(\)/);
});

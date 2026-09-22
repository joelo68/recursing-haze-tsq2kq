import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), "utf8");
const require = createRequire(import.meta.url);

const {
  APPLICATION_DIRECTORY_SUMMARY_VERSION,
  buildSanitizedLoginDirectory,
  buildLoginDirectorySummaryDocument,
  patchLoginDirectorySummaryFromSettingChange,
  patchLoginDirectorySummaryFromTherapistChange,
} = require("../functions/applicationIdentity");

const app = read("src/App.jsx");
const functionsIndex = read("functions/index.js");
const rules = read("firestore.rules");

const clone = (value) => JSON.parse(JSON.stringify(value));
const docSnap = (data, exists = true) => ({ exists, data: () => clone(data || {}) });
const changeSnap = (before, after) => ({
  before: before === null ? { exists: false, data: () => ({}) } : docSnap(before, true),
  after: after === null ? { exists: false, data: () => ({}) } : docSnap(after, true),
});

function makeSummaryEnv({ brandId = "cyj", summary = null, settings = {}, therapists = {} } = {}) {
  const state = {
    summary: summary ? clone(summary) : null,
    transactionReads: 0,
    summaryWrites: 0,
    sourceReads: [],
    collectionCalls: [],
    settingCalls: [],
  };

  const summaryRef = { kind: "summary", brandId, id: "current" };

  const db = {
    async runTransaction(callback) {
      return callback({
        async get(ref) {
          assert.equal(ref, summaryRef);
          state.transactionReads += 1;
          return state.summary ? docSnap(state.summary, true) : docSnap({}, false);
        },
        set(ref, data) {
          assert.equal(ref, summaryRef);
          state.summaryWrites += 1;
          state.summary = clone(data);
        },
      });
    },
  };

  const getBrandCollection = (_db, requestedBrandId, name) => {
    state.collectionCalls.push(`${requestedBrandId}:${name}`);
    if (name === "login_directory_summary") {
      return {
        doc(id) {
          assert.equal(id, "current");
          assert.equal(requestedBrandId, brandId);
          return summaryRef;
        },
      };
    }
    if (name === "therapists") {
      return {
        async get() {
          state.sourceReads.push(`${requestedBrandId}:therapists`);
          return {
            docs: Object.entries(therapists).map(([id, data]) => ({
              id,
              data: () => clone(data),
            })),
          };
        },
      };
    }
    throw new Error(`unexpected collection ${name}`);
  };

  const getBrandSettingDoc = (_db, requestedBrandId, name) => {
    state.settingCalls.push(`${requestedBrandId}:${name}`);
    return {
      async get() {
        state.sourceReads.push(`${requestedBrandId}:${name}`);
        return Object.prototype.hasOwnProperty.call(settings, name)
          ? docSnap(settings[name], true)
          : docSnap({}, false);
      },
    };
  };

  return { state, db, getBrandCollection, getBrandSettingDoc };
}

function makeDirectory(brandId = "cyj", overrides = {}) {
  return buildSanitizedLoginDirectory({
    brandId,
    directorAuth: {},
    trainerAuth: {},
    managerAuth: {},
    storeAccountData: { accounts: [] },
    therapists: [],
    ...overrides,
  });
}

test("B1C2E-2 password-only account changes create zero summary reads and zero summary writes", async () => {
  const env = makeSummaryEnv();
  const result = await patchLoginDirectorySummaryFromSettingChange({
    change: changeSnap({ "北區": "old-secret" }, { "北區": "new-secret" }),
    brandId: "cyj",
    settingId: "manager_auth",
    db: env.db,
    getBrandCollection: env.getBrandCollection,
    getBrandSettingDoc: env.getBrandSettingDoc,
  });

  assert.equal(result.changed, false);
  assert.equal(result.sanitizedUnchanged, true);
  assert.equal(result.readCount, 0);
  assert.equal(env.state.transactionReads, 0);
  assert.equal(env.state.summaryWrites, 0);
  assert.deepEqual(env.state.sourceReads, []);
});

test("B1C2E-2 therapist credential-only changes create zero summary reads", async () => {
  const env = makeSummaryEnv();
  const before = { name: "王小美", store: "台北店", manager: "北區", password: "old" };
  const after = { ...before, password: "new" };
  const result = await patchLoginDirectorySummaryFromTherapistChange({
    change: changeSnap(before, after),
    brandId: "cyj",
    therapistId: "t1",
    db: env.db,
    getBrandCollection: env.getBrandCollection,
    getBrandSettingDoc: env.getBrandSettingDoc,
  });

  assert.equal(result.changed, false);
  assert.equal(result.sanitizedUnchanged, true);
  assert.equal(result.readCount, 0);
  assert.equal(env.state.transactionReads, 0);
  assert.equal(env.state.summaryWrites, 0);
});

test("therapist credential storage migration creates zero login-directory summary reads and writes", async () => {
  const env = makeSummaryEnv();
  const before = {
    name: "王小美",
    store: "台北店",
    manager: "北區",
    password: "legacy-secret",
    credentialStorageMode: "embedded_legacy",
  };
  const after = {
    name: "王小美",
    store: "台北店",
    manager: "北區",
    credentialStorageMode: "separated_v1",
    credentialMigratedAtText: "2026-09-13T14:30:00.000Z",
  };
  const result = await patchLoginDirectorySummaryFromTherapistChange({
    change: changeSnap(before, after),
    brandId: "cyj",
    therapistId: "t1",
    db: env.db,
    getBrandCollection: env.getBrandCollection,
    getBrandSettingDoc: env.getBrandSettingDoc,
  });

  assert.equal(result.changed, false);
  assert.equal(result.sanitizedUnchanged, true);
  assert.equal(result.readCount, 0);
  assert.equal(env.state.transactionReads, 0);
  assert.equal(env.state.summaryWrites, 0);
});

test("B1C2E-2 first visible mutation seeds one complete brand summary, then later mutations are one-summary-read only", async () => {
  const settings = {
    store_account_data: { accounts: [{ id: "s1", name: "店經理", password: "secret", stores: ["台北店"] }] },
    manager_auth: { "北區": "manager-secret" },
    trainer_auth: { accounts: { tr1: { id: "tr1", name: "教專", password: "trainer-secret" } }, trainerOrder: ["tr1"] },
    director_auth: { accounts: { d1: { id: "d1", name: "營運主管", password: "director-secret", level: "operation_admin" } }, directorOrder: ["d1"] },
  };
  const therapists = {
    t1: { name: "王小美", store: "台北店", manager: "北區", password: "therapist-secret", isActive: true },
  };
  const env = makeSummaryEnv({ settings, therapists });

  const seeded = await patchLoginDirectorySummaryFromTherapistChange({
    change: changeSnap(null, therapists.t1),
    brandId: "cyj",
    therapistId: "t1",
    db: env.db,
    getBrandCollection: env.getBrandCollection,
    getBrandSettingDoc: env.getBrandSettingDoc,
  });

  assert.equal(seeded.changed, true);
  assert.equal(seeded.seeded, true);
  assert.equal(seeded.readCount, 7); // 2 summary reads + 4 setting docs + 1 therapist doc.
  assert.equal(env.state.transactionReads, 2);
  assert.equal(env.state.summaryWrites, 1);
  assert.equal(env.state.summary.version, APPLICATION_DIRECTORY_SUMMARY_VERSION);
  assert.equal(env.state.summary.brandId, "cyj");
  assert.equal(env.state.summary.revision, 1);
  assert.equal(env.state.summary.directory.therapists.length, 1);
  assert.equal(env.state.summary.directory.therapists[0].name, "王小美");
  assert.doesNotMatch(JSON.stringify(env.state.summary), /password|secret|token/i);

  const readsBefore = env.state.sourceReads.length;
  const transactionReadsBefore = env.state.transactionReads;
  const updated = await patchLoginDirectorySummaryFromTherapistChange({
    change: changeSnap(therapists.t1, { ...therapists.t1, name: "王小美A" }),
    brandId: "cyj",
    therapistId: "t1",
    db: env.db,
    getBrandCollection: env.getBrandCollection,
    getBrandSettingDoc: env.getBrandSettingDoc,
  });

  assert.equal(updated.changed, true);
  assert.equal(updated.seeded, undefined);
  assert.equal(updated.readCount, 1);
  assert.equal(env.state.transactionReads - transactionReadsBefore, 1);
  assert.equal(env.state.sourceReads.length, readsBefore);
  assert.equal(env.state.summary.revision, 2);
  assert.equal(env.state.summary.directory.therapists[0].name, "王小美A");
});

test("B1C2E-2 settings patch replaces only the sanitized role slice and preserves brand isolation", async () => {
  const baseDirectory = makeDirectory("yibo", {
    managerAuth: { "一區": "old" },
    therapists: [{ id: "t1", data: { name: "管理師", store: "站前店" } }],
  });
  const env = makeSummaryEnv({
    brandId: "yibo",
    summary: buildLoginDirectorySummaryDocument({ brandId: "yibo", directory: baseDirectory, revision: 8 }),
  });

  const result = await patchLoginDirectorySummaryFromSettingChange({
    change: changeSnap({ "一區": "old" }, { "一區": "old", "二區": "new" }),
    brandId: "yibo",
    settingId: "manager_auth",
    db: env.db,
    getBrandCollection: env.getBrandCollection,
    getBrandSettingDoc: env.getBrandSettingDoc,
  });

  assert.equal(result.changed, true);
  assert.equal(result.readCount, 1);
  assert.equal(env.state.summary.brandId, "yibo");
  assert.equal(env.state.summary.revision, 9);
  assert.deepEqual(env.state.summary.directory.managers.map((row) => row.name), ["一區", "二區"]);
  assert.equal(env.state.summary.directory.therapists[0].id, "t1");
  assert.ok(env.state.collectionCalls.every((entry) => entry.startsWith("yibo:")));
});

test("B1C2E-2 trigger surface is event-driven and covers both brand path families", () => {
  assert.match(functionsIndex, /exports\.onLegacyLoginDirectoryTherapistChange/);
  assert.match(functionsIndex, /artifacts\/\{appId\}\/public\/data\/therapists\/\{id\}/);
  assert.match(functionsIndex, /exports\.onBrandLoginDirectoryTherapistChange/);
  assert.match(functionsIndex, /brands\/\{brandId\}\/therapists\/\{id\}/);
  assert.match(functionsIndex, /exports\.onLegacyLoginDirectorySettingChange/);
  assert.match(functionsIndex, /global_settings\/\{settingId\}/);
  assert.match(functionsIndex, /exports\.onBrandLoginDirectorySettingChange/);
  assert.match(functionsIndex, /brands\/\{brandId\}\/settings\/\{settingId\}/);

  const start = functionsIndex.indexOf("★ B1C2E-2 Login Directory Freshness");
  const end = functionsIndex.indexOf("★ 6. 終極盤點機", start);
  const block = functionsIndex.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.doesNotMatch(block, /setInterval\s*\(|setTimeout\s*\(|collectionGroup\s*\(/);
});

test("B1C2E-2 frontend keeps the realtime surface to one login-screen-only document listener", () => {
  const start = app.indexOf("B1C2E-2：只有登入畫面監聽 1 份 sanitized directory summary");
  const end = app.indexOf("const unsubReadTrackerConfig", start);
  const block = app.slice(start, end);
  assert.ok(start >= 0 && end > start);

  assert.match(block, /user && hasSelectedBrand && !userRole && !pendingDeviceLogin/);
  assert.match(block, /doc\(getCollectionPath\("login_directory_summary"\), "current"\)/);
  assert.equal((block.match(/onSnapshot\s*\(/g) || []).length, 1);
  assert.doesNotMatch(block, /getDocs\s*\(|query\s*\(|setInterval\s*\(|fetchGlobalData\s*\(/);
  assert.match(block, /login_directory_summary_login_screen/);
});

test("B1C2E-2 sanitized summary remains bootstrap-readable, browser-read-only, and brand isolated", () => {
  assert.match(
    rules,
    /match \/brands\/\{brandId\}\/login_directory_summary\/\{document=\*\*\}\s*\{\s*allow read: if anonymousBootstrap\(\) \|\| sameBrandIdentity\(brandId\);\s*allow write: if false;/s
  );
  assert.match(
    rules,
    /match \/artifacts\/\{appId\}\/public\/data\/login_directory_summary\/\{document=\*\*\}\s*\{\s*allow read: if \(appId == 'default-app-id' && anonymousBootstrap\(\)\) \|\| cyjLegacyIdentity\(appId\);\s*allow write: if false;/s
  );
  assert.equal((rules.match(/collectionName != 'login_directory_summary'/g) || []).length, 2);
});

test("B1C2E-2 keeps app version unchanged", () => {
  assert.match(app, /CURRENT_APP_VERSION\s*=\s*"3\.6\.0"/);
});

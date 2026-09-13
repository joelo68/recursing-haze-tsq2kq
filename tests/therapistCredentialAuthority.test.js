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
  THERAPIST_CREDENTIAL_SCHEMA_VERSION,
  THERAPIST_CREDENTIAL_STORAGE_MODE_EMBEDDED,
  THERAPIST_CREDENTIAL_STORAGE_MODE_SEPARATED,
  normalizeTherapistCredentialStorageMode,
  buildEmbeddedCredentialCreateFields,
  buildTherapistCredentialState,
  loadTherapistCredentialSource,
  updateTherapistCredentialPasswordInTransaction,
  resetTherapistCredentialPasswordInTransaction,
  migrateTherapistCredentialInTransaction,
} = require("../functions/therapistCredentialAuthority");

const deviceApproval = read("functions/deviceApproval.js");
const accountAuthority = read("functions/accountAuthority.js");
const therapistMaster = read("functions/therapistMasterAuthority.js");
const rules = read("firestore.rules");
const functionsIndex = read("functions/index.js");

function makeEnv({ brandId = "cyj", therapists = {}, credentials = {} } = {}) {
  const refs = new Map();
  const reads = [];
  const writes = [];
  const deletes = [];

  function seed(collection, rows) {
    Object.entries(rows || {}).forEach(([id, data]) => {
      const key = `${brandId}:${collection}:${id}`;
      refs.set(key, { key, id, exists: true, data: structuredClone(data) });
    });
  }
  seed("therapists", therapists);
  seed("therapist_credentials", credentials);

  function refFor(b, collection, id) {
    const key = `${b}:${collection}:${id}`;
    if (!refs.has(key)) refs.set(key, { key, id, exists: false, data: {} });
    const ref = refs.get(key);
    ref.get = async () => {
      reads.push(key);
      return { exists: ref.exists, id: ref.id, data: () => structuredClone(ref.data || {}) };
    };
    return ref;
  }

  const getBrandCollection = (_db, b, collection) => ({
    doc: (id) => refFor(b, collection, id),
  });

  const db = {};
  const transaction = {
    async get(ref) {
      reads.push(ref.key);
      return { exists: ref.exists, id: ref.id, data: () => structuredClone(ref.data || {}) };
    },
    set(ref, data, options = {}) {
      writes.push({ key: ref.key, data: structuredClone(data), options });
      ref.exists = true;
      ref.data = options.merge ? { ...(ref.data || {}), ...structuredClone(data) } : structuredClone(data);
    },
    delete(ref) {
      deletes.push(ref.key);
      ref.exists = false;
      ref.data = {};
    },
  };

  return { db, getBrandCollection, transaction, refs, reads, writes, deletes };
}

const separatedDoc = (brandId, therapistId, password = "private-secret") => ({
  schemaVersion: THERAPIST_CREDENTIAL_SCHEMA_VERSION,
  brandId,
  therapistId,
  password,
  createdAtText: "2026-09-12T09:00:00.000Z",
  updatedAtText: "2026-09-12T09:00:00.000Z",
  migratedAtText: "2026-09-12T09:00:00.000Z",
});

test("B1C2B storage mode defaults old therapist masters to embedded legacy and unknown markers fail closed", () => {
  assert.equal(normalizeTherapistCredentialStorageMode({}), THERAPIST_CREDENTIAL_STORAGE_MODE_EMBEDDED);
  assert.equal(normalizeTherapistCredentialStorageMode({ credentialStorageMode: "embedded_legacy_pending_migration" }), THERAPIST_CREDENTIAL_STORAGE_MODE_EMBEDDED);
  assert.equal(normalizeTherapistCredentialStorageMode({ credentialStorageMode: "embedded_legacy" }), THERAPIST_CREDENTIAL_STORAGE_MODE_EMBEDDED);
  assert.equal(normalizeTherapistCredentialStorageMode({ credentialStorageMode: "separated_v1" }), THERAPIST_CREDENTIAL_STORAGE_MODE_SEPARATED);
  assert.throws(
    () => normalizeTherapistCredentialStorageMode({ credentialStorageMode: "future_unknown_mode" }),
    /invalid_credential_storage_mode/
  );
});

test("legacy therapist login reads only the therapist master and does not add a credential read", async () => {
  const env = makeEnv({
    therapists: {
      t1: { id: "t1", name: "A", password: "legacy-secret", isActive: true },
    },
  });
  const source = await loadTherapistCredentialSource({
    db: env.db,
    brandId: "cyj",
    therapistId: "t1",
    getBrandCollection: env.getBrandCollection,
  });
  assert.equal(source.mode, THERAPIST_CREDENTIAL_STORAGE_MODE_EMBEDDED);
  assert.equal(source.password, "legacy-secret");
  assert.deepEqual(env.reads, ["cyj:therapists:t1"]);
});

test("separated therapist login reads exact-brand master then one exact credential document", async () => {
  const env = makeEnv({
    brandId: "yibo",
    therapists: {
      t1: { id: "t1", name: "A", credentialStorageMode: "separated_v1", isActive: true },
    },
    credentials: {
      t1: separatedDoc("yibo", "t1", "separated-secret"),
    },
  });
  const source = await loadTherapistCredentialSource({
    db: env.db,
    brandId: "yibo",
    therapistId: "t1",
    getBrandCollection: env.getBrandCollection,
  });
  assert.equal(source.mode, THERAPIST_CREDENTIAL_STORAGE_MODE_SEPARATED);
  assert.equal(source.password, "separated-secret");
  assert.deepEqual(env.reads, ["yibo:therapists:t1", "yibo:therapist_credentials:t1"]);

  const crossBrand = makeEnv({
    brandId: "yibo",
    therapists: {
      t1: { id: "t1", credentialStorageMode: "separated_v1", isActive: true },
    },
    credentials: {
      t1: separatedDoc("cyj", "t1", "wrong-brand-secret"),
    },
  });
  await assert.rejects(
    loadTherapistCredentialSource({
      db: crossBrand.db,
      brandId: "yibo",
      therapistId: "t1",
      getBrandCollection: crossBrand.getBrandCollection,
    }),
    /credential_document_invalid/
  );
});

test("password change writes only the currently authoritative therapist credential source", async () => {
  const legacy = makeEnv({
    therapists: {
      t1: { id: "t1", password: "old", isActive: true },
    },
  });
  const legacyResult = await updateTherapistCredentialPasswordInTransaction({
    transaction: legacy.transaction,
    db: legacy.db,
    brandId: "cyj",
    therapistId: "t1",
    currentPassword: "old",
    newPassword: "new",
    nowText: "2026-09-12T09:00:00.000Z",
    getBrandCollection: legacy.getBrandCollection,
    passwordMatches: (a, b) => a === b,
  });
  assert.equal(legacyResult.mode, THERAPIST_CREDENTIAL_STORAGE_MODE_EMBEDDED);
  assert.deepEqual(legacy.writes.map((row) => row.key), ["cyj:therapists:t1"]);

  const separated = makeEnv({
    therapists: {
      t1: { id: "t1", credentialStorageMode: "separated_v1", isActive: true },
    },
    credentials: {
      t1: separatedDoc("cyj", "t1", "old"),
    },
  });
  const separatedResult = await updateTherapistCredentialPasswordInTransaction({
    transaction: separated.transaction,
    db: separated.db,
    brandId: "cyj",
    therapistId: "t1",
    currentPassword: "old",
    newPassword: "new",
    nowText: "2026-09-12T09:00:00.000Z",
    getBrandCollection: separated.getBrandCollection,
    passwordMatches: (a, b) => a === b,
  });
  assert.equal(separatedResult.mode, THERAPIST_CREDENTIAL_STORAGE_MODE_SEPARATED);
  assert.deepEqual(separated.writes.map((row) => row.key), ["cyj:therapist_credentials:t1"]);
});

test("admin reset writes only the authoritative therapist credential source and never migrates storage mode", async () => {
  const legacy = makeEnv({
    therapists: {
      t1: { id: "t1", password: "private-old", credentialStorageMode: "embedded_legacy", isActive: true },
    },
  });
  const legacyResult = await resetTherapistCredentialPasswordInTransaction({
    transaction: legacy.transaction,
    db: legacy.db,
    brandId: "cyj",
    therapistId: "t1",
    newPassword: "0000",
    nowText: "2026-09-12T15:30:00.000Z",
    getBrandCollection: legacy.getBrandCollection,
  });
  assert.equal(legacyResult.mode, THERAPIST_CREDENTIAL_STORAGE_MODE_EMBEDDED);
  assert.deepEqual(legacy.reads, ["cyj:therapists:t1"]);
  assert.deepEqual(legacy.writes.map((row) => row.key), ["cyj:therapists:t1"]);
  assert.equal(legacy.writes[0].data.password, "0000");
  assert.equal(legacy.refs.get("cyj:therapists:t1").data.credentialStorageMode, "embedded_legacy");

  const separated = makeEnv({
    brandId: "yibo",
    therapists: {
      t1: { id: "t1", credentialStorageMode: "separated_v1", isActive: true },
    },
    credentials: {
      t1: separatedDoc("yibo", "t1", "private-old"),
    },
  });
  const separatedResult = await resetTherapistCredentialPasswordInTransaction({
    transaction: separated.transaction,
    db: separated.db,
    brandId: "yibo",
    therapistId: "t1",
    newPassword: "0000",
    nowText: "2026-09-12T15:30:00.000Z",
    getBrandCollection: separated.getBrandCollection,
  });
  assert.equal(separatedResult.mode, THERAPIST_CREDENTIAL_STORAGE_MODE_SEPARATED);
  assert.deepEqual(separated.reads, [
    "yibo:therapists:t1",
    "yibo:therapist_credentials:t1",
  ]);
  assert.deepEqual(separated.writes.map((row) => row.key), ["yibo:therapist_credentials:t1"]);
  assert.equal(separated.writes[0].data.password, "0000");
  assert.equal(separated.refs.get("yibo:therapists:t1").data.password, undefined);
});

test("admin reset refuses an inactive therapist credential source", async () => {
  const env = makeEnv({
    therapists: {
      t1: { id: "t1", password: "private-old", isActive: false, status: "離職" },
    },
  });
  await assert.rejects(
    resetTherapistCredentialPasswordInTransaction({
      transaction: env.transaction,
      db: env.db,
      brandId: "cyj",
      therapistId: "t1",
      newPassword: "0000",
      nowText: "2026-09-12T15:30:00.000Z",
      getBrandCollection: env.getBrandCollection,
    }),
    /account_inactive/
  );
  assert.equal(env.writes.length, 0);
});

test("atomic separation helper creates credential and removes legacy password in one transaction surface", async () => {
  const env = makeEnv({
    brandId: "anniu",
    therapists: {
      t1: { id: "t1", name: "A", password: "legacy-secret", isActive: true },
    },
  });
  const result = await migrateTherapistCredentialInTransaction({
    transaction: env.transaction,
    db: env.db,
    brandId: "anniu",
    therapistId: "t1",
    getBrandCollection: env.getBrandCollection,
    nowText: "2026-09-12T09:00:00.000Z",
    serverTimestamp: () => ({ __serverTimestamp: true }),
    deleteField: () => ({ __deleteField: true }),
  });
  assert.equal(result.changed, true);
  assert.equal(result.mode, THERAPIST_CREDENTIAL_STORAGE_MODE_SEPARATED);
  assert.deepEqual(env.reads.sort(), [
    "anniu:therapist_credentials:t1",
    "anniu:therapists:t1",
  ].sort());
  assert.deepEqual(env.writes.map((row) => row.key), [
    "anniu:therapist_credentials:t1",
    "anniu:therapists:t1",
  ]);
  const credentialWrite = env.writes[0];
  assert.equal(credentialWrite.data.password, "legacy-secret");
  assert.equal(credentialWrite.data.brandId, "anniu");
  assert.equal(credentialWrite.data.therapistId, "t1");
  const masterWrite = env.writes[1];
  assert.equal(masterWrite.data.credentialStorageMode, "separated_v1");
  assert.deepEqual(masterWrite.data.password, { __deleteField: true });
});

test("credential state classifier rejects dual sources and validates separated schema", () => {
  const legacy = buildEmbeddedCredentialCreateFields("0000");
  assert.equal(legacy.credentialStorageMode, "embedded_legacy");
  assert.equal(legacy.password, "0000");

  assert.deepEqual(
    buildTherapistCredentialState({ brandId: "cyj", therapistId: "t1", masterData: legacy, credentialExists: false }),
    { ok: true, classification: "EMBEDDED_LEGACY_READY", mode: "embedded_legacy" }
  );
  assert.equal(
    buildTherapistCredentialState({ brandId: "cyj", therapistId: "t1", masterData: legacy, credentialExists: true, credentialData: separatedDoc("cyj", "t1") }).classification,
    "DUAL_SOURCE_CONFLICT"
  );
  assert.equal(
    buildTherapistCredentialState({ brandId: "cyj", therapistId: "t1", masterData: { credentialStorageMode: "separated_v1" }, credentialExists: true, credentialData: separatedDoc("cyj", "t1") }).classification,
    "SEPARATED_V1_READY"
  );
});

test("login, password change and therapist master share credential authority while B1C2C2 cuts only master administration over", () => {
  assert.match(deviceApproval, /loadTherapistCredentialSource/);
  assert.match(accountAuthority, /updateTherapistCredentialPasswordInTransaction/);
  assert.match(therapistMaster, /buildEmbeddedCredentialCreateFields/);
  assert.match(therapistMaster, /resetTherapistCredentialPasswordInTransaction/);
  assert.match(therapistMaster, /deleteSeparatedTherapistCredentialInTransaction/);
  assert.doesNotMatch(functionsIndex, /migrateTherapistCredential|auditTherapistCredential/);
  assert.doesNotMatch(deviceApproval, /onSnapshot\s*\(|setInterval\s*\(/);
});

test("therapist_credentials is backend-only on CYJ legacy and Anniu/Yibo brand paths despite broad wildcard rules", () => {
  assert.match(rules, /match \/brands\/\{brandId\}\/therapist_credentials\/\{document=\*\*\}[\s\S]{0,100}allow read, write: if false;/);
  assert.match(rules, /match \/artifacts\/\{appId\}\/public\/data\/therapist_credentials\/\{document=\*\*\}[\s\S]{0,100}allow read, write: if false;/);
  const exclusions = rules.match(/collectionName != 'therapist_credentials'/g) || [];
  assert.equal(exclusions.length, 2);
});

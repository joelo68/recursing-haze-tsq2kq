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
  THERAPIST_CREDENTIAL_STORAGE_MODE_SEPARATED,
  normalizeTherapistCredentialStorageMode,
  buildSeparatedCredentialCreateDocument,
  inspectTherapistCredentialState,
  loadTherapistCredentialSource,
  updateTherapistCredentialPasswordInTransaction,
  resetTherapistCredentialPasswordInTransaction,
  deleteSeparatedTherapistCredentialInTransaction,
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
});

test("post-migration storage authority accepts separated_v1 only and fails closed on retired legacy markers", () => {
  assert.equal(
    normalizeTherapistCredentialStorageMode({ credentialStorageMode: "separated_v1" }),
    THERAPIST_CREDENTIAL_STORAGE_MODE_SEPARATED
  );
  for (const credentialStorageMode of ["", "embedded_legacy", "embedded_legacy_pending_migration"]) {
    assert.throws(
      () => normalizeTherapistCredentialStorageMode({ credentialStorageMode }),
      /legacy_credential_retired/
    );
  }
  assert.throws(
    () => normalizeTherapistCredentialStorageMode({ credentialStorageMode: "future_unknown_mode" }),
    /invalid_credential_storage_mode/
  );
});

test("native separated credential provisioning has no migration provenance", () => {
  const doc = buildSeparatedCredentialCreateDocument({
    brandId: "anniu",
    therapistId: "t-new",
    password: "0000",
    nowText: "2026-09-13T14:00:00.000Z",
    serverTimestamp: () => ({ __serverTimestamp: true }),
  });
  assert.equal(doc.schemaVersion, THERAPIST_CREDENTIAL_SCHEMA_VERSION);
  assert.equal(doc.brandId, "anniu");
  assert.equal(doc.therapistId, "t-new");
  assert.equal(doc.password, "0000");
  assert.equal(doc.createdAtText, "2026-09-13T14:00:00.000Z");
  assert.equal(doc.updatedAtText, "2026-09-13T14:00:00.000Z");
  assert.equal(Object.prototype.hasOwnProperty.call(doc, "migratedFrom"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(doc, "migratedAtText"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(doc, "migratedAt"), false);
});

test("retired legacy therapist credentials fail closed before any credential-document fallback read", async () => {
  const env = makeEnv({
    therapists: {
      t1: { id: "t1", name: "A", password: "legacy-secret", credentialStorageMode: "embedded_legacy", isActive: true },
    },
  });

  await assert.rejects(
    loadTherapistCredentialSource({
      db: env.db,
      brandId: "cyj",
      therapistId: "t1",
      getBrandCollection: env.getBrandCollection,
    }),
    /legacy_credential_retired/
  );
  assert.deepEqual(env.reads, ["cyj:therapists:t1"]);
  assert.equal(env.writes.length, 0);
});

test("a separated master that still contains legacy password material fails closed without writing", async () => {
  const env = makeEnv({
    therapists: {
      t1: { id: "t1", name: "A", password: "unexpected-master-secret", credentialStorageMode: "separated_v1", isActive: true },
    },
    credentials: {
      t1: separatedDoc("cyj", "t1", "separated-secret"),
    },
  });

  await assert.rejects(
    loadTherapistCredentialSource({
      db: env.db,
      brandId: "cyj",
      therapistId: "t1",
      getBrandCollection: env.getBrandCollection,
    }),
    /credential_master_password_present/
  );
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

test("password change writes only the selected separated credential document", async () => {
  const env = makeEnv({
    therapists: {
      t1: { id: "t1", credentialStorageMode: "separated_v1", isActive: true },
      t2: { id: "t2", credentialStorageMode: "separated_v1", isActive: true },
    },
    credentials: {
      t1: separatedDoc("cyj", "t1", "old"),
      t2: separatedDoc("cyj", "t2", "keep"),
    },
  });

  const result = await updateTherapistCredentialPasswordInTransaction({
    transaction: env.transaction,
    db: env.db,
    brandId: "cyj",
    therapistId: "t1",
    currentPassword: "old",
    newPassword: "new",
    nowText: "2026-09-12T09:00:00.000Z",
    getBrandCollection: env.getBrandCollection,
    passwordMatches: (a, b) => a === b,
  });

  assert.equal(result.mode, THERAPIST_CREDENTIAL_STORAGE_MODE_SEPARATED);
  assert.deepEqual(env.writes.map((row) => row.key), ["cyj:therapist_credentials:t1"]);
  assert.equal(env.refs.get("cyj:therapist_credentials:t1").data.password, "new");
  assert.equal(env.refs.get("cyj:therapist_credentials:t2").data.password, "keep");
  assert.equal(Object.prototype.hasOwnProperty.call(env.refs.get("cyj:therapists:t1").data, "password"), false);
});

test("password change never reactivates a retired embedded credential source", async () => {
  const env = makeEnv({
    therapists: {
      t1: { id: "t1", password: "old", credentialStorageMode: "embedded_legacy", isActive: true },
    },
  });

  await assert.rejects(
    updateTherapistCredentialPasswordInTransaction({
      transaction: env.transaction,
      db: env.db,
      brandId: "cyj",
      therapistId: "t1",
      currentPassword: "old",
      newPassword: "new",
      nowText: "2026-09-12T09:00:00.000Z",
      getBrandCollection: env.getBrandCollection,
      passwordMatches: (a, b) => a === b,
    }),
    /legacy_credential_retired/
  );
  assert.equal(env.writes.length, 0);
});

test("admin reset writes only separated_v1 credential authority", async () => {
  const env = makeEnv({
    brandId: "yibo",
    therapists: {
      t1: { id: "t1", credentialStorageMode: "separated_v1", isActive: true },
    },
    credentials: {
      t1: separatedDoc("yibo", "t1", "private-old"),
    },
  });
  const result = await resetTherapistCredentialPasswordInTransaction({
    transaction: env.transaction,
    db: env.db,
    brandId: "yibo",
    therapistId: "t1",
    newPassword: "0000",
    nowText: "2026-09-12T15:30:00.000Z",
    getBrandCollection: env.getBrandCollection,
  });
  assert.equal(result.mode, THERAPIST_CREDENTIAL_STORAGE_MODE_SEPARATED);
  assert.deepEqual(env.reads, [
    "yibo:therapists:t1",
    "yibo:therapist_credentials:t1",
  ]);
  assert.deepEqual(env.writes.map((row) => row.key), ["yibo:therapist_credentials:t1"]);
  assert.equal(env.writes[0].data.password, "0000");
  assert.equal(env.refs.get("yibo:therapists:t1").data.password, undefined);
});

test("admin reset refuses inactive or retired legacy therapist credential sources", async () => {
  const inactive = makeEnv({
    therapists: {
      t1: { id: "t1", credentialStorageMode: "separated_v1", isActive: false, status: "離職" },
    },
    credentials: {
      t1: separatedDoc("cyj", "t1", "private-old"),
    },
  });
  await assert.rejects(
    resetTherapistCredentialPasswordInTransaction({
      transaction: inactive.transaction,
      db: inactive.db,
      brandId: "cyj",
      therapistId: "t1",
      newPassword: "0000",
      nowText: "2026-09-12T15:30:00.000Z",
      getBrandCollection: inactive.getBrandCollection,
    }),
    /account_inactive/
  );
  assert.equal(inactive.writes.length, 0);

  const legacy = makeEnv({
    therapists: {
      t1: { id: "t1", password: "legacy-secret", credentialStorageMode: "embedded_legacy", isActive: true },
    },
  });
  await assert.rejects(
    resetTherapistCredentialPasswordInTransaction({
      transaction: legacy.transaction,
      db: legacy.db,
      brandId: "cyj",
      therapistId: "t1",
      newPassword: "0000",
      nowText: "2026-09-12T15:30:00.000Z",
      getBrandCollection: legacy.getBrandCollection,
    }),
    /legacy_credential_retired/
  );
  assert.equal(legacy.writes.length, 0);
});

test("credential-state diagnostics classify legacy, master-password, dual-source, missing, invalid, and ready states without enabling fallback", () => {
  assert.equal(
    inspectTherapistCredentialState({
      brandId: "cyj",
      therapistId: "t1",
      masterData: { credentialStorageMode: "embedded_legacy", password: "legacy-secret" },
      credentialExists: false,
    }).classification,
    "LEGACY_CREDENTIAL_RETIRED"
  );

  assert.equal(
    inspectTherapistCredentialState({
      brandId: "cyj",
      therapistId: "t1",
      masterData: { credentialStorageMode: "separated_v1", password: "unexpected-master-secret" },
      credentialExists: false,
    }).classification,
    "MASTER_PASSWORD_PRESENT"
  );

  assert.equal(
    inspectTherapistCredentialState({
      brandId: "cyj",
      therapistId: "t1",
      masterData: { credentialStorageMode: "separated_v1", password: "unexpected-master-secret" },
      credentialExists: true,
      credentialData: separatedDoc("cyj", "t1"),
    }).classification,
    "DUAL_SOURCE_CONFLICT"
  );

  assert.equal(
    inspectTherapistCredentialState({
      brandId: "cyj",
      therapistId: "t1",
      masterData: { credentialStorageMode: "separated_v1" },
      credentialExists: false,
    }).classification,
    "SEPARATED_CREDENTIAL_MISSING"
  );

  assert.equal(
    inspectTherapistCredentialState({
      brandId: "cyj",
      therapistId: "t1",
      masterData: { credentialStorageMode: "separated_v1" },
      credentialExists: true,
      credentialData: { schemaVersion: "bad", brandId: "cyj", therapistId: "t1", password: "x" },
    }).classification,
    "SEPARATED_CREDENTIAL_INVALID"
  );

  assert.deepEqual(
    inspectTherapistCredentialState({
      brandId: "cyj",
      therapistId: "t1",
      masterData: { credentialStorageMode: "separated_v1" },
      credentialExists: true,
      credentialData: separatedDoc("cyj", "t1"),
    }),
    { ok: true, classification: "SEPARATED_V1_READY", mode: "separated_v1" }
  );
});

test("permanent delete helper deletes only the exact separated credential and rejects retired legacy master state", () => {
  const separated = makeEnv({
    therapists: {
      t1: { id: "t1", credentialStorageMode: "separated_v1", isActive: false },
    },
    credentials: {
      t1: separatedDoc("cyj", "t1"),
    },
  });
  const result = deleteSeparatedTherapistCredentialInTransaction({
    transaction: separated.transaction,
    db: separated.db,
    brandId: "cyj",
    therapistId: "t1",
    masterData: separated.refs.get("cyj:therapists:t1").data,
    getBrandCollection: separated.getBrandCollection,
  });
  assert.equal(result.deleted, true);
  assert.deepEqual(separated.deletes, ["cyj:therapist_credentials:t1"]);

  const legacy = makeEnv({
    therapists: {
      t1: { id: "t1", credentialStorageMode: "embedded_legacy", password: "legacy-secret", isActive: false },
    },
  });
  assert.throws(
    () => deleteSeparatedTherapistCredentialInTransaction({
      transaction: legacy.transaction,
      db: legacy.db,
      brandId: "cyj",
      therapistId: "t1",
      masterData: legacy.refs.get("cyj:therapists:t1").data,
      getBrandCollection: legacy.getBrandCollection,
    }),
    /legacy_credential_retired/
  );
  assert.equal(legacy.deletes.length, 0);
});

test("login, password change and therapist master share separated-only credential authority with no migration runtime", () => {
  assert.match(deviceApproval, /loadTherapistCredentialSource/);
  assert.match(accountAuthority, /updateTherapistCredentialPasswordInTransaction/);
  assert.match(therapistMaster, /buildSeparatedCredentialCreateDocument/);
  assert.match(therapistMaster, /resetTherapistCredentialPasswordInTransaction/);
  assert.match(therapistMaster, /deleteSeparatedTherapistCredentialInTransaction/);
  assert.doesNotMatch(therapistMaster, /migrate_credential|credential_migration_inventory|confirmCredentialMigration|migrateTherapistCredentialInTransaction|buildEmbeddedCredentialCreateFields/);
  assert.doesNotMatch(functionsIndex, /exports\.(?:migrateTherapistCredential|auditTherapistCredential)/);
  assert.doesNotMatch(deviceApproval, /onSnapshot\s*\(|setInterval\s*\(/);
});

test("therapist_credentials remains backend-only on CYJ legacy root and Anniu/Yibo brand roots", () => {
  assert.match(rules, /match \/brands\/\{brandId\}\/therapist_credentials\/\{document=\*\*\}[\s\S]{0,100}allow read, write: if false;/);
  assert.match(rules, /match \/artifacts\/\{appId\}\/public\/data\/therapist_credentials\/\{document=\*\*\}[\s\S]{0,100}allow read, write: if false;/);
  const exclusions = rules.match(/collectionName != 'therapist_credentials'/g) || [];
  assert.equal(exclusions.length, 2);
});

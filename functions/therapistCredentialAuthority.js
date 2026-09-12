const THERAPIST_CREDENTIAL_SCHEMA_VERSION = "therapist-credential-v1";
const THERAPIST_CREDENTIAL_STORAGE_MODE_EMBEDDED = "embedded_legacy";
const THERAPIST_CREDENTIAL_STORAGE_MODE_SEPARATED = "separated_v1";
const LEGACY_STORAGE_MODE_ALIASES = new Set([
  "",
  THERAPIST_CREDENTIAL_STORAGE_MODE_EMBEDDED,
  "embedded_legacy_pending_migration",
]);

class TherapistCredentialAuthorityError extends Error {
  constructor(code, status = 409, extra = {}) {
    super(code);
    this.code = code;
    this.status = status;
    Object.assign(this, extra || {});
  }
}

function normalizeText(value = "", maxLength = 180) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function assertTherapistCredentialBrandId(value = "") {
  const brandId = normalizeText(value, 24).toLowerCase();
  if (!["cyj", "anniu", "yibo"].includes(brandId)) {
    throw new TherapistCredentialAuthorityError("invalid_brand", 400);
  }
  return brandId;
}

function normalizeTherapistCredentialStorageMode(source = {}) {
  const rawMode = typeof source === "string" ? source : source?.credentialStorageMode;
  const mode = normalizeText(rawMode, 64).toLowerCase();
  if (LEGACY_STORAGE_MODE_ALIASES.has(mode)) {
    return THERAPIST_CREDENTIAL_STORAGE_MODE_EMBEDDED;
  }
  if (mode === THERAPIST_CREDENTIAL_STORAGE_MODE_SEPARATED) {
    return THERAPIST_CREDENTIAL_STORAGE_MODE_SEPARATED;
  }
  throw new TherapistCredentialAuthorityError("invalid_credential_storage_mode", 409, {
    credentialStorageMode: mode,
  });
}

function isTherapistInactive(raw = {}) {
  const status = normalizeText(raw?.status, 40).toLowerCase();
  return (
    raw?.isActive === false ||
    raw?.resigned === true ||
    raw?.isResigned === true ||
    ["resigned", "離職", "封存"].includes(status)
  );
}

function getTherapistCredentialRefs({ db, brandId, therapistId, getBrandCollection }) {
  if (!db) throw new Error("missing_db");
  if (typeof getBrandCollection !== "function") throw new Error("missing_getBrandCollection");
  const safeBrandId = assertTherapistCredentialBrandId(brandId);
  const safeTherapistId = normalizeText(therapistId, 180);
  if (!safeTherapistId) throw new TherapistCredentialAuthorityError("invalid_therapist_id", 400);
  return {
    brandId: safeBrandId,
    therapistId: safeTherapistId,
    therapistRef: getBrandCollection(db, safeBrandId, "therapists").doc(safeTherapistId),
    credentialRef: getBrandCollection(db, safeBrandId, "therapist_credentials").doc(safeTherapistId),
  };
}

function normalizeSeparatedCredentialDocument(raw = {}, { brandId, therapistId } = {}) {
  const safeBrandId = assertTherapistCredentialBrandId(brandId);
  const safeTherapistId = normalizeText(therapistId, 180);
  const schemaVersion = normalizeText(raw?.schemaVersion, 80);
  const storedBrandId = normalizeText(raw?.brandId, 24).toLowerCase();
  const storedTherapistId = normalizeText(raw?.therapistId, 180);
  const password = typeof raw?.password === "string" ? raw.password : "";
  if (
    schemaVersion !== THERAPIST_CREDENTIAL_SCHEMA_VERSION ||
    storedBrandId !== safeBrandId ||
    storedTherapistId !== safeTherapistId ||
    !password
  ) {
    throw new TherapistCredentialAuthorityError("credential_document_invalid", 409);
  }
  return {
    schemaVersion,
    brandId: storedBrandId,
    therapistId: storedTherapistId,
    password,
    createdAtText: normalizeText(raw?.createdAtText, 80),
    updatedAtText: normalizeText(raw?.updatedAtText, 80),
    migratedAtText: normalizeText(raw?.migratedAtText, 80),
  };
}

function buildSeparatedCredentialDocument({ brandId, therapistId, password, nowText, serverTimestamp } = {}) {
  const safeBrandId = assertTherapistCredentialBrandId(brandId);
  const safeTherapistId = normalizeText(therapistId, 180);
  const credentialPassword = String(password ?? "");
  if (!safeTherapistId) throw new TherapistCredentialAuthorityError("invalid_therapist_id", 400);
  if (!credentialPassword) throw new TherapistCredentialAuthorityError("credential_password_missing", 409);
  const record = {
    schemaVersion: THERAPIST_CREDENTIAL_SCHEMA_VERSION,
    brandId: safeBrandId,
    therapistId: safeTherapistId,
    password: credentialPassword,
    createdAtText: normalizeText(nowText, 80),
    updatedAtText: normalizeText(nowText, 80),
    migratedAtText: normalizeText(nowText, 80),
    migratedFrom: "therapists.password",
  };
  if (typeof serverTimestamp === "function") {
    const timestamp = serverTimestamp();
    record.createdAt = timestamp;
    record.updatedAt = timestamp;
    record.migratedAt = timestamp;
  }
  return record;
}

function buildEmbeddedCredentialCreateFields(password = "") {
  const credentialPassword = String(password ?? "");
  if (!credentialPassword) throw new TherapistCredentialAuthorityError("credential_password_missing", 500);
  return {
    credentialStorageMode: THERAPIST_CREDENTIAL_STORAGE_MODE_EMBEDDED,
    password: credentialPassword,
  };
}

function buildTherapistCredentialState({ brandId, therapistId, masterData = {}, credentialExists = false, credentialData = {} } = {}) {
  const mode = normalizeTherapistCredentialStorageMode(masterData);
  const masterHasPassword = typeof masterData?.password === "string" && masterData.password.length > 0;
  if (mode === THERAPIST_CREDENTIAL_STORAGE_MODE_EMBEDDED) {
    if (!masterHasPassword) return { ok: false, classification: "LEGACY_PASSWORD_MISSING", mode };
    if (credentialExists) return { ok: false, classification: "DUAL_SOURCE_CONFLICT", mode };
    return { ok: true, classification: "EMBEDDED_LEGACY_READY", mode };
  }
  if (masterHasPassword) return { ok: false, classification: "DUAL_SOURCE_CONFLICT", mode };
  if (!credentialExists) return { ok: false, classification: "SEPARATED_CREDENTIAL_MISSING", mode };
  try {
    normalizeSeparatedCredentialDocument(credentialData, { brandId, therapistId });
  } catch (error) {
    return {
      ok: false,
      classification: "SEPARATED_CREDENTIAL_INVALID",
      mode,
      code: String(error?.code || "credential_document_invalid"),
    };
  }
  return { ok: true, classification: "SEPARATED_V1_READY", mode };
}

async function loadTherapistCredentialSource({ db, brandId, therapistId, getBrandCollection, transaction = null, requireActive = true } = {}) {
  const refs = getTherapistCredentialRefs({ db, brandId, therapistId, getBrandCollection });
  const read = transaction ? (ref) => transaction.get(ref) : (ref) => ref.get();
  const therapistSnap = await read(refs.therapistRef);
  if (!therapistSnap?.exists) throw new TherapistCredentialAuthorityError("account_missing", 404);
  const masterData = therapistSnap.data() || {};
  if (requireActive && isTherapistInactive(masterData)) {
    throw new TherapistCredentialAuthorityError("account_inactive", 403);
  }
  const mode = normalizeTherapistCredentialStorageMode(masterData);
  if (mode === THERAPIST_CREDENTIAL_STORAGE_MODE_EMBEDDED) {
    const password = typeof masterData.password === "string" ? masterData.password : "";
    if (!password) throw new TherapistCredentialAuthorityError("credential_source_missing", 409);
    return { ...refs, mode, masterData, password, credentialData: null };
  }
  const credentialSnap = await read(refs.credentialRef);
  if (!credentialSnap?.exists) throw new TherapistCredentialAuthorityError("credential_source_missing", 409);
  if (typeof masterData.password === "string" && masterData.password.length > 0) {
    throw new TherapistCredentialAuthorityError("credential_dual_source_conflict", 409);
  }
  const credentialData = normalizeSeparatedCredentialDocument(credentialSnap.data() || {}, {
    brandId: refs.brandId,
    therapistId: refs.therapistId,
  });
  return { ...refs, mode, masterData, credentialData, password: credentialData.password };
}

async function updateTherapistCredentialPasswordInTransaction({
  transaction,
  db,
  brandId,
  therapistId,
  currentPassword,
  newPassword,
  nowText,
  getBrandCollection,
  passwordMatches,
} = {}) {
  if (!transaction || typeof transaction.get !== "function" || typeof transaction.set !== "function") {
    throw new Error("missing_transaction");
  }
  if (typeof passwordMatches !== "function") throw new Error("missing_password_matcher");
  const source = await loadTherapistCredentialSource({
    transaction,
    db,
    brandId,
    therapistId,
    getBrandCollection,
    requireActive: true,
  });
  if (!passwordMatches(currentPassword, source.password)) {
    throw new TherapistCredentialAuthorityError("credential_changed", 409);
  }
  if (source.mode === THERAPIST_CREDENTIAL_STORAGE_MODE_EMBEDDED) {
    transaction.set(source.therapistRef, {
      password: String(newPassword ?? ""),
      updatedAtText: normalizeText(nowText, 80),
    }, { merge: true });
  } else {
    transaction.set(source.credentialRef, {
      password: String(newPassword ?? ""),
      updatedAtText: normalizeText(nowText, 80),
    }, { merge: true });
  }
  return { mode: source.mode, therapistId: source.therapistId };
}

async function migrateTherapistCredentialInTransaction({
  transaction,
  db,
  brandId,
  therapistId,
  getBrandCollection,
  nowText,
  serverTimestamp,
  deleteField,
} = {}) {
  if (!transaction || typeof transaction.get !== "function" || typeof transaction.set !== "function") {
    throw new Error("missing_transaction");
  }
  if (typeof deleteField !== "function") throw new Error("missing_delete_field");
  const refs = getTherapistCredentialRefs({ db, brandId, therapistId, getBrandCollection });
  const [therapistSnap, credentialSnap] = await Promise.all([
    transaction.get(refs.therapistRef),
    transaction.get(refs.credentialRef),
  ]);
  if (!therapistSnap?.exists) throw new TherapistCredentialAuthorityError("account_missing", 404);
  const masterData = therapistSnap.data() || {};
  const mode = normalizeTherapistCredentialStorageMode(masterData);
  if (mode === THERAPIST_CREDENTIAL_STORAGE_MODE_SEPARATED) {
    const state = buildTherapistCredentialState({
      brandId: refs.brandId,
      therapistId: refs.therapistId,
      masterData,
      credentialExists: credentialSnap?.exists === true,
      credentialData: credentialSnap?.exists ? (credentialSnap.data() || {}) : {},
    });
    if (!state.ok) {
      throw new TherapistCredentialAuthorityError("credential_separation_state_invalid", 409, {
        classification: state.classification,
      });
    }
    return { changed: false, mode, classification: state.classification };
  }
  if (credentialSnap?.exists) throw new TherapistCredentialAuthorityError("credential_dual_source_conflict", 409);
  const password = typeof masterData.password === "string" ? masterData.password : "";
  if (!password) throw new TherapistCredentialAuthorityError("credential_source_missing", 409);
  const credentialRecord = buildSeparatedCredentialDocument({
    brandId: refs.brandId,
    therapistId: refs.therapistId,
    password,
    nowText,
    serverTimestamp,
  });
  transaction.set(refs.credentialRef, credentialRecord, { merge: false });
  transaction.set(refs.therapistRef, {
    credentialStorageMode: THERAPIST_CREDENTIAL_STORAGE_MODE_SEPARATED,
    credentialMigratedAtText: normalizeText(nowText, 80),
    password: deleteField(),
  }, { merge: true });
  return {
    changed: true,
    mode: THERAPIST_CREDENTIAL_STORAGE_MODE_SEPARATED,
    classification: "SEPARATED_V1_READY",
  };
}

function deleteSeparatedTherapistCredentialInTransaction({ transaction, db, brandId, therapistId, masterData, getBrandCollection } = {}) {
  if (!transaction || typeof transaction.delete !== "function") throw new Error("missing_transaction");
  const mode = normalizeTherapistCredentialStorageMode(masterData || {});
  if (mode !== THERAPIST_CREDENTIAL_STORAGE_MODE_SEPARATED) return { deleted: false, mode };
  const refs = getTherapistCredentialRefs({ db, brandId, therapistId, getBrandCollection });
  transaction.delete(refs.credentialRef);
  return { deleted: true, mode };
}

module.exports = {
  THERAPIST_CREDENTIAL_SCHEMA_VERSION,
  THERAPIST_CREDENTIAL_STORAGE_MODE_EMBEDDED,
  THERAPIST_CREDENTIAL_STORAGE_MODE_SEPARATED,
  TherapistCredentialAuthorityError,
  assertTherapistCredentialBrandId,
  normalizeTherapistCredentialStorageMode,
  isTherapistInactive,
  getTherapistCredentialRefs,
  normalizeSeparatedCredentialDocument,
  buildSeparatedCredentialDocument,
  buildEmbeddedCredentialCreateFields,
  buildTherapistCredentialState,
  loadTherapistCredentialSource,
  updateTherapistCredentialPasswordInTransaction,
  migrateTherapistCredentialInTransaction,
  deleteSeparatedTherapistCredentialInTransaction,
};

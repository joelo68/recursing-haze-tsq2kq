const crypto = require("node:crypto");
const {
  THERAPIST_CREDENTIAL_STORAGE_MODE_EMBEDDED,
  normalizeTherapistCredentialStorageMode,
  buildEmbeddedCredentialCreateFields,
  deleteSeparatedTherapistCredentialInTransaction,
} = require("./therapistCredentialAuthority");

const THERAPIST_MASTER_AUTHORITY_VERSION = "therapist-master-authority-v1";
const SUPPORTED_THERAPIST_MASTER_ACTIONS = new Set([
  "create",
  "update",
  "archive",
  "restore",
  "delete",
]);
const FORBIDDEN_PAYLOAD_KEYS = new Set([
  "password",
  "currentPassword",
  "newPassword",
  "credentialPassword",
  "credential",
  "credentials",
]);
const ALLOWED_CREATE_UPDATE_KEYS = new Set([
  "name",
  "store",
  "storeName",
  "onboardDate",
  "resignDate",
]);
const RESERVED_OBJECT_KEYS = new Set(["__proto__", "prototype", "constructor"]);

class TherapistMasterAuthorityError extends Error {
  constructor(code, status = 400, extra = {}) {
    super(code);
    this.code = code;
    this.status = status;
    Object.assign(this, extra || {});
  }
}

function normalizeText(value = "", max = 160) {
  return String(value ?? "").trim().slice(0, max);
}

function assertSupportedBrandId(value = "") {
  const brandId = normalizeText(value, 24).toLowerCase();
  if (!["cyj", "anniu", "yibo"].includes(brandId)) {
    throw new TherapistMasterAuthorityError("invalid_brand", 400);
  }
  return brandId;
}

function normalizeTherapistId(value = "") {
  const id = normalizeText(value, 180);
  if (!id || RESERVED_OBJECT_KEYS.has(id.toLowerCase())) {
    throw new TherapistMasterAuthorityError("invalid_therapist_id", 400);
  }
  return id;
}

function normalizeTherapistName(value = "") {
  const name = normalizeText(value, 120);
  if (!name) throw new TherapistMasterAuthorityError("missing_therapist_name", 400);
  return name;
}

function normalizeDate(value = "", { required = false, field = "date" } = {}) {
  const text = normalizeText(value, 24);
  if (!text) {
    if (required) throw new TherapistMasterAuthorityError(`missing_${field}`, 400);
    return "";
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new TherapistMasterAuthorityError(`invalid_${field}`, 400);
  }
  const [year, month, day] = text.split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (
    utc.getUTCFullYear() !== year ||
    utc.getUTCMonth() !== month - 1 ||
    utc.getUTCDate() !== day
  ) {
    throw new TherapistMasterAuthorityError(`invalid_${field}`, 400);
  }
  return text;
}

function getTaipeiDateString(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const pick = (type) => parts.find((part) => part.type === type)?.value || "";
  return `${pick("year")}-${pick("month")}-${pick("day")}`;
}

function assertChronology(onboardDate = "", resignDate = "") {
  if (onboardDate && resignDate && resignDate < onboardDate) {
    throw new TherapistMasterAuthorityError("resign_before_onboard", 400);
  }
}

function assertPayloadIsMasterOnly(payload = {}, action = "") {
  const source = payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload
    : {};
  for (const key of Object.keys(source)) {
    if (FORBIDDEN_PAYLOAD_KEYS.has(key)) {
      throw new TherapistMasterAuthorityError("credential_payload_not_allowed", 400);
    }
  }
  if (action === "create" || action === "update") {
    for (const key of Object.keys(source)) {
      if (!ALLOWED_CREATE_UPDATE_KEYS.has(key)) {
        throw new TherapistMasterAuthorityError("unsupported_master_field", 400, {
          unsupportedField: key,
        });
      }
    }
  } else if (Object.keys(source).some((key) => !["resignDate"].includes(key))) {
    throw new TherapistMasterAuthorityError("unsupported_master_field", 400);
  }
  return source;
}

function normalizeStoreList(values = []) {
  const list = Array.isArray(values) ? values : [values];
  return [...new Set(list.map((value) => normalizeText(value, 160)).filter(Boolean))].slice(0, 32);
}

function isUnassignedManagerName(value = "") {
  const text = normalizeText(value, 120).replace(/[　\s]+/g, "");
  return text.includes("未分配") || text.includes("未分區");
}

function buildOrganizationStoreIndex(organizationRaw = {}, normalizeStoreCore) {
  const managers = organizationRaw?.managers && typeof organizationRaw.managers === "object"
    ? organizationRaw.managers
    : {};
  const byCore = new Map();
  const duplicates = [];

  Object.entries(managers).forEach(([rawManagerName, rawStores]) => {
    const managerName = normalizeText(rawManagerName, 120);
    normalizeStoreList(rawStores).forEach((rawStore) => {
      const core = normalizeText(normalizeStoreCore(rawStore), 160);
      if (!core) throw new TherapistMasterAuthorityError("invalid_store_identity", 400);
      const previous = byCore.get(core);
      if (previous) {
        duplicates.push({
          core,
          firstManager: previous.managerName,
          secondManager: managerName,
        });
        return;
      }
      byCore.set(core, {
        core,
        rawStore,
        managerName,
      });
    });
  });

  if (duplicates.length) {
    throw new TherapistMasterAuthorityError("organization_duplicate_store", 409);
  }
  return byCore;
}

function resolveTherapistStore({
  inputStore = "",
  organizationRaw = {},
  normalizeStoreCore,
}) {
  const input = normalizeText(inputStore, 160);
  if (!input) throw new TherapistMasterAuthorityError("missing_store", 400);
  const core = normalizeText(normalizeStoreCore(input), 160);
  if (!core) throw new TherapistMasterAuthorityError("invalid_store_identity", 400);
  const entry = buildOrganizationStoreIndex(organizationRaw, normalizeStoreCore).get(core);
  if (!entry) throw new TherapistMasterAuthorityError("store_outside_brand_organization", 400);
  return {
    core,
    canonicalOrganizationStore: entry.rawStore,
    managerName: isUnassignedManagerName(entry.managerName) ? "" : entry.managerName,
  };
}

function isTherapistArchived(raw = {}) {
  const status = normalizeText(raw?.status, 40).toLowerCase();
  return (
    raw?.isActive === false ||
    raw?.isResigned === true ||
    raw?.resigned === true ||
    ["resigned", "離職", "封存"].includes(status)
  );
}

function normalizeMasterProjection(raw = {}) {
  const stores = normalizeStoreList([
    ...(Array.isArray(raw?.stores) ? raw.stores : []),
    raw?.store,
    raw?.storeName,
    raw?.primaryStore,
  ]);
  return {
    id: normalizeText(raw?.id || "", 180),
    name: normalizeText(raw?.name || raw?.displayName || "", 120),
    store: normalizeText(raw?.store || raw?.storeName || raw?.primaryStore || stores[0] || "", 160),
    storeName: normalizeText(raw?.storeName || raw?.store || raw?.primaryStore || stores[0] || "", 160),
    stores,
    manager: normalizeText(raw?.manager || raw?.managerName || raw?.region || "", 120),
    managerName: normalizeText(raw?.managerName || raw?.manager || raw?.region || "", 120),
    region: normalizeText(raw?.region || raw?.manager || raw?.managerName || "", 120),
    onboardDate: normalizeText(raw?.onboardDate || raw?.startDate || "", 24),
    resignDate: normalizeText(raw?.resignDate || "", 24),
    inactiveDate: normalizeText(raw?.inactiveDate || "", 24),
    offboardDate: normalizeText(raw?.offboardDate || "", 24),
    status: normalizeText(raw?.status || "", 40),
    isActive: raw?.isActive !== false,
    isResigned: raw?.isResigned === true,
    resigned: raw?.resigned === true,
  };
}

function buildTherapistMasterSignature(raw = {}) {
  const stable = normalizeMasterProjection(raw);
  return crypto.createHash("sha256")
    .update(JSON.stringify(stable))
    .digest("hex");
}

function assertExpectedMasterSignature(expectedSignature = "", currentRaw = {}) {
  const expected = normalizeText(expectedSignature, 128);
  if (!expected) {
    throw new TherapistMasterAuthorityError("master_signature_required", 400);
  }
  const current = buildTherapistMasterSignature(currentRaw);
  if (expected !== current) {
    throw new TherapistMasterAuthorityError("therapist_master_conflict", 409, {
      currentMasterSignature: current,
    });
  }
  return current;
}

function makeMasterFields({
  therapistId,
  name,
  store,
  managerName,
  onboardDate,
  resignDate,
  archived,
  nowText,
  serverTimestamp,
  includeCreated = false,
}) {
  const fields = {
    id: therapistId,
    name,
    store,
    storeName: store,
    stores: store ? [store] : [],
    manager: managerName || "",
    managerName: managerName || "",
    region: managerName || "",
    onboardDate,
    resignDate: archived ? resignDate : "",
    inactiveDate: "",
    offboardDate: "",
    status: archived ? "離職" : "在職",
    isActive: !archived,
    isResigned: archived,
    resigned: archived,
    updatedAt: serverTimestamp(),
    updatedAtText: nowText,
  };
  if (includeCreated) {
    fields.createdAt = serverTimestamp();
    fields.createdAtText = nowText;
  }
  return fields;
}

function sanitizeTherapistResponse(raw = {}) {
  const master = normalizeMasterProjection(raw);
  return {
    ...master,
    archived: isTherapistArchived(raw),
  };
}

function applyTherapistMasterAction({
  action,
  therapistId,
  payload,
  currentRaw,
  organizationRaw,
  brandId,
  nowText,
  todayText,
  normalizeStoreCore,
  getInitialPasswordsForRole,
  serverTimestamp,
}) {
  if (!SUPPORTED_THERAPIST_MASTER_ACTIONS.has(action)) {
    throw new TherapistMasterAuthorityError("unsupported_therapist_master_action", 400);
  }

  const data = assertPayloadIsMasterOnly(payload, action);
  const current = currentRaw && typeof currentRaw === "object" ? currentRaw : null;

  if (action === "create") {
    const id = normalizeTherapistId(therapistId);
    const name = normalizeTherapistName(data.name);
    const resolvedStore = resolveTherapistStore({
      inputStore: data.store || data.storeName,
      organizationRaw,
      normalizeStoreCore,
    });
    const onboardDate = normalizeDate(data.onboardDate || todayText, {
      required: true,
      field: "onboard_date",
    });
    const resignDate = normalizeDate(data.resignDate || "", { field: "resign_date" });
    assertChronology(onboardDate, resignDate);
    const archived = Boolean(resignDate);
    const initialPassword = String(getInitialPasswordsForRole("therapist", brandId)?.[0] || "");
    if (!initialPassword) throw new TherapistMasterAuthorityError("initial_password_unavailable", 500);

    const next = {
      ...makeMasterFields({
        therapistId: id,
        name,
        store: resolvedStore.core,
        managerName: resolvedStore.managerName,
        onboardDate,
        resignDate,
        archived,
        nowText,
        serverTimestamp,
        includeCreated: true,
      }),
      // B1C2B foundation: existing/new therapists remain legacy-authoritative until
      // an explicit atomic migration flips this account to separated_v1.
      // Never accept password or storage mode from an administrative payload.
      ...buildEmbeddedCredentialCreateFields(initialPassword),
    };

    return {
      next,
      therapistId: id,
      deleted: false,
      archived,
      requiresInitialPasswordChange: true,
      initialCredentialProvisioned: true,
      storeCore: resolvedStore.core,
      managerName: resolvedStore.managerName,
    };
  }

  if (!current) throw new TherapistMasterAuthorityError("therapist_missing", 404);
  const id = normalizeTherapistId(therapistId);

  if (action === "delete") {
    if (!isTherapistArchived(current)) {
      throw new TherapistMasterAuthorityError("archive_before_delete_required", 409);
    }
    return {
      next: null,
      therapistId: id,
      deleted: true,
      archived: true,
      requiresInitialPasswordChange: false,
      initialCredentialProvisioned: false,
      storeCore: normalizeText(current.store || current.storeName || "", 160),
      managerName: normalizeText(current.manager || current.managerName || "", 120),
    };
  }

  if (action === "archive") {
    const onboardDate = normalizeDate(
      current.onboardDate || current.startDate || "",
      { field: "onboard_date" }
    );
    const resignDate = normalizeDate(data.resignDate || todayText, {
      required: true,
      field: "resign_date",
    });
    assertChronology(onboardDate, resignDate);
    const next = {
      isActive: false,
      isResigned: true,
      resigned: true,
      status: "離職",
      resignDate,
      inactiveDate: "",
      offboardDate: "",
      updatedAt: serverTimestamp(),
      updatedAtText: nowText,
    };
    return {
      next,
      therapistId: id,
      deleted: false,
      archived: true,
      requiresInitialPasswordChange: false,
      initialCredentialProvisioned: false,
      storeCore: normalizeText(current.store || current.storeName || "", 160),
      managerName: normalizeText(current.manager || current.managerName || "", 120),
    };
  }

  const currentStore = current.store || current.storeName || current.primaryStore ||
    (Array.isArray(current.stores) ? current.stores[0] : "");
  const resolvedStore = resolveTherapistStore({
    inputStore: action === "update"
      ? (data.store || data.storeName || currentStore)
      : currentStore,
    organizationRaw,
    normalizeStoreCore,
  });

  if (action === "restore") {
    const next = {
      store: resolvedStore.core,
      storeName: resolvedStore.core,
      stores: [resolvedStore.core],
      manager: resolvedStore.managerName || "",
      managerName: resolvedStore.managerName || "",
      region: resolvedStore.managerName || "",
      isActive: true,
      isResigned: false,
      resigned: false,
      status: "在職",
      resignDate: "",
      inactiveDate: "",
      offboardDate: "",
      updatedAt: serverTimestamp(),
      updatedAtText: nowText,
    };
    return {
      next,
      therapistId: id,
      deleted: false,
      archived: false,
      requiresInitialPasswordChange: false,
      initialCredentialProvisioned: false,
      storeCore: resolvedStore.core,
      managerName: resolvedStore.managerName,
    };
  }

  const name = Object.prototype.hasOwnProperty.call(data, "name")
    ? normalizeTherapistName(data.name)
    : normalizeTherapistName(current.name || current.displayName);
  const onboardDate = Object.prototype.hasOwnProperty.call(data, "onboardDate")
    ? normalizeDate(data.onboardDate, { required: true, field: "onboard_date" })
    : normalizeDate(current.onboardDate || current.startDate || todayText, {
        required: true,
        field: "onboard_date",
      });

  const resignSpecified = Object.prototype.hasOwnProperty.call(data, "resignDate");
  const resignDate = resignSpecified
    ? normalizeDate(data.resignDate || "", { field: "resign_date" })
    : normalizeDate(current.resignDate || "", { field: "resign_date" });
  const archived = resignSpecified ? Boolean(resignDate) : isTherapistArchived(current);
  const effectiveResignDate = archived ? (resignDate || normalizeDate(current.resignDate || "", { field: "resign_date" })) : "";
  assertChronology(onboardDate, effectiveResignDate);

  const next = makeMasterFields({
    therapistId: id,
    name,
    store: resolvedStore.core,
    managerName: resolvedStore.managerName,
    onboardDate,
    resignDate: effectiveResignDate,
    archived,
    nowText,
    serverTimestamp,
    includeCreated: false,
  });

  return {
    next,
    therapistId: id,
    deleted: false,
    archived,
    requiresInitialPasswordChange: false,
    initialCredentialProvisioned: false,
    storeCore: resolvedStore.core,
    managerName: resolvedStore.managerName,
  };
}

async function manageTherapistMasterInTransaction({
  transaction,
  db,
  brandId,
  action,
  therapistRef,
  therapistId,
  payload,
  expectedMasterSignature,
  confirmPermanentDelete,
  nowText,
  todayText,
  actorCheck,
  getBrandCollection,
  getBrandSettingDoc,
  normalizeStoreCore,
  getInitialPasswordsForRole,
  serverTimestamp,
}) {
  const isCreate = action === "create";
  const needsOrganization = ["create", "update", "restore"].includes(action);
  const orgRef = needsOrganization
    ? getBrandSettingDoc(db, brandId, "org_structure")
    : null;

  const therapistSnap = await transaction.get(therapistRef);
  if (isCreate && therapistSnap.exists) {
    throw new TherapistMasterAuthorityError("therapist_id_collision", 409);
  }
  if (!isCreate && !therapistSnap.exists) {
    throw new TherapistMasterAuthorityError("therapist_missing", 404);
  }

  const currentRaw = therapistSnap.exists ? (therapistSnap.data() || {}) : null;
  const previousMasterSignature = isCreate
    ? ""
    : assertExpectedMasterSignature(expectedMasterSignature, currentRaw);

  let organizationRaw = {};
  if (orgRef) {
    const orgSnap = await transaction.get(orgRef);
    if (!orgSnap.exists) throw new TherapistMasterAuthorityError("organization_missing", 404);
    organizationRaw = orgSnap.data() || {};
  }

  if (action === "delete" && confirmPermanentDelete !== true) {
    throw new TherapistMasterAuthorityError("permanent_delete_confirmation_required", 400);
  }

  const result = applyTherapistMasterAction({
    action,
    therapistId,
    payload,
    currentRaw,
    organizationRaw,
    brandId,
    nowText,
    todayText,
    normalizeStoreCore,
    getInitialPasswordsForRole,
    serverTimestamp,
  });

  if (result.deleted) {
    deleteSeparatedTherapistCredentialInTransaction({
      transaction,
      db,
      brandId,
      therapistId,
      masterData: currentRaw || {},
      getBrandCollection,
    });
    transaction.delete(therapistRef);
  } else if (isCreate) {
    transaction.set(therapistRef, result.next, { merge: false });
  } else {
    // Merge preserves the latest credential and unrelated legacy/operational fields.
    // Because this transaction read the document first, a concurrent password change
    // causes Firestore to retry; the semantic master signature intentionally excludes password.
    transaction.set(therapistRef, result.next, { merge: true });
  }

  const nextRecord = result.deleted
    ? null
    : { ...(currentRaw || {}), ...(result.next || {}) };
  const nextMasterSignature = nextRecord ? buildTherapistMasterSignature(nextRecord) : "";

  const maintenanceRef = getBrandCollection(db, brandId, "maintenance_logs").doc();
  transaction.set(maintenanceRef, {
    type: "therapist_master_authority",
    action: `therapist_${action}`,
    brandId,
    operator: String(actorCheck?.actorName || actorCheck?.actorAccountId || "最高管理者"),
    operatorRole: "director",
    therapistId,
    therapistName: normalizeText(
      nextRecord?.name || currentRaw?.name || currentRaw?.displayName || therapistId,
      120
    ),
    store: normalizeText(
      nextRecord?.store || currentRaw?.store || currentRaw?.storeName || "",
      160
    ),
    archived: result.archived === true,
    deleted: result.deleted === true,
    createdAtText: nowText,
    source: THERAPIST_MASTER_AUTHORITY_VERSION,
  }, { merge: false });

  const auditRef = getBrandCollection(db, brandId, "system_logs").doc();
  transaction.set(auditRef, {
    createdAtText: nowText,
    activityType: "organization.therapist_master_management",
    action: "管理師人員資料管理",
    role: "director",
    user: String(actorCheck?.actorName || actorCheck?.actorAccountId || "最高管理者"),
    brand: brandId,
    details: {
      managedAction: action,
      therapistId,
      therapistName: normalizeText(
        nextRecord?.name || currentRaw?.name || currentRaw?.displayName || therapistId,
        120
      ),
      store: normalizeText(
        nextRecord?.store || currentRaw?.store || currentRaw?.storeName || "",
        160
      ),
      archived: result.archived === true,
      deleted: result.deleted === true,
      initialCredentialProvisioned: result.initialCredentialProvisioned === true,
      masterSignatureBefore: previousMasterSignature,
      masterSignatureAfter: nextMasterSignature,
    },
  }, { merge: false });

  return {
    ...result,
    previousMasterSignature,
    masterSignature: nextMasterSignature,
    therapist: nextRecord ? sanitizeTherapistResponse(nextRecord) : null,
    credentialStorageMode: result.deleted
      ? normalizeTherapistCredentialStorageMode(currentRaw || {})
      : normalizeTherapistCredentialStorageMode(nextRecord || {}),
  };
}

function createTherapistMasterAuthorityFunctions({
  onRequest,
  db,
  runtimeServiceAccount,
  normalizeBrandId,
  getBrandCollection,
  getBrandSettingDoc,
  requireFirebaseRequestAuth,
  verifySuperAdminActor,
  assertAdminApplicationClaims,
  normalizeStoreCore,
  getInitialPasswordsForRole,
  serverTimestamp,
}) {
  if (typeof onRequest !== "function") throw new Error("missing_onRequest");
  if (!db) throw new Error("missing_db");
  if (!runtimeServiceAccount) throw new Error("missing_runtime_service_account");
  [
    normalizeBrandId,
    getBrandCollection,
    getBrandSettingDoc,
    requireFirebaseRequestAuth,
    verifySuperAdminActor,
    assertAdminApplicationClaims,
    normalizeStoreCore,
    getInitialPasswordsForRole,
    serverTimestamp,
  ].forEach((fn, index) => {
    if (typeof fn !== "function") throw new Error(`missing_dependency_${index}`);
  });

  const manageTherapistMaster = onRequest({
    cors: true,
    timeoutSeconds: 20,
    memory: "256MiB",
    serviceAccount: runtimeServiceAccount,
  }, async (req, res) => {
    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, code: "method_not_allowed" });
    }
    res.set?.("Cache-Control", "private, no-store");

    const requestAuth = await requireFirebaseRequestAuth(req);
    if (!requestAuth?.ok) {
      return res.status(401).json({ ok: false, code: "firebase_auth_required" });
    }

    try {
      const body = req.body || {};
      const requestedBrand = normalizeText(body.brandId, 24).toLowerCase();
      const brandId = assertSupportedBrandId(requestedBrand);
      if (normalizeBrandId(requestedBrand) !== brandId) {
        throw new TherapistMasterAuthorityError("invalid_brand", 400);
      }

      const action = normalizeText(body.action, 32).toLowerCase();
      if (!SUPPORTED_THERAPIST_MASTER_ACTIONS.has(action)) {
        throw new TherapistMasterAuthorityError("unsupported_therapist_master_action", 400);
      }

      const actor = body.actor || {};
      assertAdminApplicationClaims(requestAuth, brandId, actor, {
        actorAccountId: actor?.accountId,
      });

      const actorCheck = await verifySuperAdminActor({ db, brandId, actor });
      if (!actorCheck?.ok) {
        throw new TherapistMasterAuthorityError("super_admin_reverification_required", 403);
      }
      assertAdminApplicationClaims(requestAuth, brandId, actor, actorCheck);

      const payload = body.payload && typeof body.payload === "object" && !Array.isArray(body.payload)
        ? body.payload
        : {};
      assertPayloadIsMasterOnly(payload, action);

      let therapistRef;
      let therapistId;
      if (action === "create") {
        therapistRef = getBrandCollection(db, brandId, "therapists").doc();
        therapistId = normalizeTherapistId(therapistRef.id);
      } else {
        therapistId = normalizeTherapistId(body.therapistId || body.accountId || "");
        therapistRef = getBrandCollection(db, brandId, "therapists").doc(therapistId);
      }

      const expectedMasterSignature = normalizeText(body.expectedMasterSignature, 128);
      if (action !== "create" && !expectedMasterSignature) {
        throw new TherapistMasterAuthorityError("master_signature_required", 400);
      }

      const now = new Date();
      const nowText = now.toISOString();
      const todayText = getTaipeiDateString(now);

      const result = await db.runTransaction(async (transaction) => (
        manageTherapistMasterInTransaction({
          transaction,
          db,
          brandId,
          action,
          therapistRef,
          therapistId,
          payload,
          expectedMasterSignature,
          confirmPermanentDelete: body.confirmPermanentDelete === true,
          nowText,
          todayText,
          actorCheck,
          getBrandCollection,
          getBrandSettingDoc,
          normalizeStoreCore,
          getInitialPasswordsForRole,
          serverTimestamp,
        })
      ));

      return res.status(200).json({
        ok: true,
        brandId,
        action,
        therapistId: result.therapistId,
        archived: result.archived === true,
        deleted: result.deleted === true,
        requiresInitialPasswordChange: result.requiresInitialPasswordChange === true,
        masterSignature: result.masterSignature,
        therapist: result.therapist,
        credentialStorageMode: result.credentialStorageMode || THERAPIST_CREDENTIAL_STORAGE_MODE_EMBEDDED,
      });
    } catch (error) {
      const status = Number(error?.status || 500);
      const code = String(error?.code || "therapist_master_management_failed");
      if (status >= 500) console.error("manageTherapistMaster failed", code);
      return res.status(status).json({
        ok: false,
        code,
        ...(error?.currentMasterSignature
          ? { currentMasterSignature: error.currentMasterSignature }
          : {}),
        ...(error?.unsupportedField
          ? { unsupportedField: error.unsupportedField }
          : {}),
      });
    }
  });

  return { manageTherapistMaster };
}

module.exports = {
  THERAPIST_MASTER_AUTHORITY_VERSION,
  SUPPORTED_THERAPIST_MASTER_ACTIONS,
  TherapistMasterAuthorityError,
  normalizeMasterProjection,
  buildTherapistMasterSignature,
  buildOrganizationStoreIndex,
  resolveTherapistStore,
  isTherapistArchived,
  applyTherapistMasterAction,
  manageTherapistMasterInTransaction,
  createTherapistMasterAuthorityFunctions,
};

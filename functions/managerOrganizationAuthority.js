const crypto = require("node:crypto");

const MANAGER_ORGANIZATION_AUTHORITY_VERSION = "manager-organization-authority-v1";
const UNASSIGNED_MANAGER_KEY = "未分配";
const SUPPORTED_MANAGER_ORGANIZATION_ACTIONS = new Set(["create", "update", "delete"]);
const RESERVED_MANAGER_KEYS = new Set(["__proto__", "prototype", "constructor"]);

class ManagerOrganizationAuthorityError extends Error {
  constructor(code, status = 400, extra = {}) {
    super(code);
    this.code = code;
    this.status = status;
    Object.assign(this, extra || {});
  }
}

function normalizeText(value = "", max = 160) {
  return String(value || "").trim().slice(0, max);
}

function assertSupportedBrandId(value = "") {
  const brandId = normalizeText(value, 24).toLowerCase();
  if (!["cyj", "anniu", "yibo"].includes(brandId)) {
    throw new ManagerOrganizationAuthorityError("invalid_brand", 400);
  }
  return brandId;
}

function normalizeManagerName(value = "") {
  const name = normalizeText(value, 120);
  if (!name) throw new ManagerOrganizationAuthorityError("missing_manager_name", 400);
  if (name === UNASSIGNED_MANAGER_KEY) {
    throw new ManagerOrganizationAuthorityError("reserved_manager_name", 400);
  }
  if (RESERVED_MANAGER_KEYS.has(name.toLowerCase())) {
    throw new ManagerOrganizationAuthorityError("reserved_manager_name", 400);
  }
  return name;
}

function normalizeStoreList(values = []) {
  const list = Array.isArray(values) ? values : [values];
  return [...new Set(list.map((value) => normalizeText(value, 160)).filter(Boolean))].slice(0, 256);
}

function isEndingManagerOption(value = "") {
  const text = String(value || "").replace(/[　\s]+/g, "").trim();
  return (
    text.includes("未分配") ||
    text.includes("未分區") ||
    text.includes("其他") ||
    text.includes("離職") ||
    text.includes("封存") ||
    text.includes("停用")
  );
}

function zhCompare(a = "", b = "") {
  return String(a || "").localeCompare(String(b || ""), "zh-Hant", {
    numeric: true,
    sensitivity: "base",
  });
}

function normalizeManagerOrder(managers = {}, managerOrder = []) {
  const managerKeys = Object.keys(managers || {});
  const orderSource = Array.isArray(managerOrder) && managerOrder.length > 0
    ? managerOrder
    : [...managerKeys].sort(zhCompare);

  const seen = new Set();
  const normal = [];
  const ending = [];

  orderSource.forEach((rawName) => {
    const name = normalizeText(rawName, 120);
    if (!name || seen.has(name) || !managerKeys.includes(name)) return;
    seen.add(name);
    if (isEndingManagerOption(name)) ending.push(name);
    else normal.push(name);
  });

  [...managerKeys]
    .filter((name) => !seen.has(name))
    .sort(zhCompare)
    .forEach((name) => {
      if (isEndingManagerOption(name)) ending.push(name);
      else normal.push(name);
    });

  return [...normal, ...ending];
}

function cloneManagers(raw = {}) {
  const source = raw && typeof raw === "object" ? raw : {};
  const managers = {};
  Object.entries(source).forEach(([rawName, rawStores]) => {
    const name = normalizeText(rawName, 120);
    if (!name) return;
    if (RESERVED_MANAGER_KEYS.has(name.toLowerCase())) {
      throw new ManagerOrganizationAuthorityError("invalid_organization_manager_name", 409);
    }
    managers[name] = normalizeStoreList(rawStores);
  });
  if (!Object.prototype.hasOwnProperty.call(managers, UNASSIGNED_MANAGER_KEY)) {
    managers[UNASSIGNED_MANAGER_KEY] = [];
  }
  return managers;
}

function buildManagerOrganizationSignature(raw = {}) {
  const managers = cloneManagers(raw?.managers || {});
  const managerOrder = normalizeManagerOrder(managers, raw?.managerOrder || []);
  const stableManagers = {};
  Object.keys(managers).sort(zhCompare).forEach((name) => {
    stableManagers[name] = [...managers[name]];
  });
  return crypto.createHash("sha256")
    .update(JSON.stringify({ managers: stableManagers, managerOrder }))
    .digest("hex");
}

function buildStoreIndex(managers = {}, normalizeStoreCore) {
  const byCore = new Map();
  const duplicates = [];
  Object.entries(managers || {}).forEach(([managerName, stores]) => {
    normalizeStoreList(stores).forEach((rawStore) => {
      const core = normalizeText(normalizeStoreCore(rawStore), 160);
      if (!core) throw new ManagerOrganizationAuthorityError("invalid_store_identity", 400);
      const previous = byCore.get(core);
      if (previous) {
        duplicates.push({
          core,
          firstManager: previous.managerName,
          secondManager: managerName,
        });
        return;
      }
      byCore.set(core, { core, rawStore, managerName });
    });
  });
  if (duplicates.length) {
    throw new ManagerOrganizationAuthorityError("organization_duplicate_store", 409);
  }
  return byCore;
}

function resolveRequestedStores({
  requestedStores = [],
  currentManagers = {},
  targetManagerName = "",
  normalizeStoreCore,
}) {
  const storeIndex = buildStoreIndex(currentManagers, normalizeStoreCore);
  const resolved = [];
  const seen = new Set();

  normalizeStoreList(requestedStores).forEach((input) => {
    const core = normalizeText(normalizeStoreCore(input), 160);
    if (!core) throw new ManagerOrganizationAuthorityError("invalid_store_identity", 400);
    if (seen.has(core)) return;
    seen.add(core);

    const current = storeIndex.get(core);
    if (!current) {
      throw new ManagerOrganizationAuthorityError("store_outside_organization", 400);
    }
    if (
      current.managerName !== targetManagerName &&
      current.managerName !== UNASSIGNED_MANAGER_KEY
    ) {
      throw new ManagerOrganizationAuthorityError("store_owned_by_other_manager", 409);
    }
    resolved.push(current.rawStore);
  });

  return resolved;
}

function renameManagerCredentialEntry(entry, nextName) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return entry;
  const next = { ...entry };
  if (Object.prototype.hasOwnProperty.call(next, "name")) next.name = nextName;
  if (Object.prototype.hasOwnProperty.call(next, "id")) next.id = nextName;
  if (Object.prototype.hasOwnProperty.call(next, "accountId")) next.accountId = nextName;
  return next;
}

function assertExpectedSignature(expectedSignature, organizationRaw) {
  const expected = normalizeText(expectedSignature, 128);
  if (!expected) throw new ManagerOrganizationAuthorityError("organization_signature_required", 400);
  const currentSignature = buildManagerOrganizationSignature(organizationRaw);
  if (expected !== currentSignature) {
    throw new ManagerOrganizationAuthorityError("organization_conflict", 409, {
      currentOrganizationSignature: currentSignature,
    });
  }
  return currentSignature;
}

function applyManagerOrganizationAction({
  action,
  targetManagerName,
  payload,
  organizationRaw,
  managerAuthRaw,
  brandId,
  nowText,
  normalizeStoreCore,
  getInitialPasswordsForRole,
}) {
  if (!SUPPORTED_MANAGER_ORGANIZATION_ACTIONS.has(action)) {
    throw new ManagerOrganizationAuthorityError("unsupported_manager_org_action", 400);
  }

  const managers = cloneManagers(organizationRaw?.managers || {});
  const currentOrder = normalizeManagerOrder(managers, organizationRaw?.managerOrder || []);
  const managerAuth = managerAuthRaw && typeof managerAuthRaw === "object"
    ? { ...managerAuthRaw }
    : {};
  const data = payload && typeof payload === "object" ? payload : {};
  buildStoreIndex(managers, normalizeStoreCore);

  if (action === "create") {
    const nextName = normalizeManagerName(data.name);
    if (Object.prototype.hasOwnProperty.call(managers, nextName)) {
      throw new ManagerOrganizationAuthorityError("manager_already_exists", 409);
    }
    if (Object.prototype.hasOwnProperty.call(managerAuth, nextName)) {
      throw new ManagerOrganizationAuthorityError("manager_credential_already_exists", 409);
    }
    const initialPassword = String(getInitialPasswordsForRole("manager", brandId)?.[0] || "");
    if (!initialPassword) throw new ManagerOrganizationAuthorityError("initial_password_unavailable", 500);

    managers[nextName] = [];
    managerAuth[nextName] = initialPassword;
    const preferred = [
      ...currentOrder.filter((name) => name !== UNASSIGNED_MANAGER_KEY),
      nextName,
      UNASSIGNED_MANAGER_KEY,
    ];
    return {
      managers,
      managerOrder: normalizeManagerOrder(managers, preferred),
      managerAuth,
      accountId: nextName,
      nextName,
      previousName: "",
      storesMovedToUnassigned: [],
      requiresInitialPasswordChange: true,
      deleted: false,
      nowText,
    };
  }

  const currentName = normalizeManagerName(targetManagerName);
  if (!Object.prototype.hasOwnProperty.call(managers, currentName)) {
    throw new ManagerOrganizationAuthorityError("manager_missing", 404);
  }
  if (!Object.prototype.hasOwnProperty.call(managerAuth, currentName)) {
    throw new ManagerOrganizationAuthorityError("manager_credential_missing", 409);
  }

  if (action === "update") {
    const nextName = normalizeManagerName(data.name || currentName);
    if (
      nextName !== currentName &&
      Object.prototype.hasOwnProperty.call(managers, nextName)
    ) {
      throw new ManagerOrganizationAuthorityError("manager_already_exists", 409);
    }
    if (
      nextName !== currentName &&
      Object.prototype.hasOwnProperty.call(managerAuth, nextName)
    ) {
      throw new ManagerOrganizationAuthorityError("manager_credential_already_exists", 409);
    }

    const originalStores = normalizeStoreList(managers[currentName] || []);
    const requestedStores = Object.prototype.hasOwnProperty.call(data, "stores")
      ? resolveRequestedStores({
          requestedStores: data.stores,
          currentManagers: managers,
          targetManagerName: currentName,
          normalizeStoreCore,
        })
      : originalStores;

    const requestedCores = new Set(
      requestedStores.map((store) => normalizeText(normalizeStoreCore(store), 160)).filter(Boolean)
    );
    const releasedStores = originalStores.filter(
      (store) => !requestedCores.has(normalizeText(normalizeStoreCore(store), 160))
    );

    const nextManagers = {};
    Object.entries(managers).forEach(([name, stores]) => {
      if (name === currentName || name === UNASSIGNED_MANAGER_KEY) return;
      nextManagers[name] = normalizeStoreList(stores);
    });

    const existingUnassigned = normalizeStoreList(managers[UNASSIGNED_MANAGER_KEY] || []);
    const requestedCoreSet = requestedCores;
    const nextUnassigned = [];
    [...existingUnassigned, ...releasedStores].forEach((rawStore) => {
      const core = normalizeText(normalizeStoreCore(rawStore), 160);
      if (!core || requestedCoreSet.has(core)) return;
      if (!nextUnassigned.some((item) => normalizeText(normalizeStoreCore(item), 160) === core)) {
        nextUnassigned.push(rawStore);
      }
    });

    nextManagers[nextName] = requestedStores;
    nextManagers[UNASSIGNED_MANAGER_KEY] = nextUnassigned;

    const previousCredential = managerAuth[currentName];
    if (nextName !== currentName) delete managerAuth[currentName];
    managerAuth[nextName] = renameManagerCredentialEntry(previousCredential, nextName);

    const preferredOrder = currentOrder
      .map((name) => name === currentName ? nextName : name)
      .filter((name, index, array) => array.indexOf(name) === index);

    return {
      managers: nextManagers,
      managerOrder: normalizeManagerOrder(nextManagers, preferredOrder),
      managerAuth,
      accountId: nextName,
      nextName,
      previousName: currentName,
      storesMovedToUnassigned: releasedStores,
      requiresInitialPasswordChange: false,
      deleted: false,
      nowText,
    };
  }

  const storesToMove = normalizeStoreList(managers[currentName] || []);
  const nextManagers = {};
  Object.entries(managers).forEach(([name, stores]) => {
    if (name === currentName || name === UNASSIGNED_MANAGER_KEY) return;
    nextManagers[name] = normalizeStoreList(stores);
  });

  const nextUnassigned = normalizeStoreList([
    ...(managers[UNASSIGNED_MANAGER_KEY] || []),
    ...storesToMove,
  ]);
  nextManagers[UNASSIGNED_MANAGER_KEY] = nextUnassigned;
  delete managerAuth[currentName];

  return {
    managers: nextManagers,
    managerOrder: normalizeManagerOrder(
      nextManagers,
      currentOrder.filter((name) => name !== currentName)
    ),
    managerAuth,
    accountId: currentName,
    nextName: "",
    previousName: currentName,
    storesMovedToUnassigned: storesToMove,
    requiresInitialPasswordChange: false,
    deleted: true,
    nowText,
  };
}

async function manageManagerOrganizationInTransaction({
  transaction,
  db,
  brandId,
  action,
  targetManagerName,
  payload,
  expectedOrganizationSignature,
  nowText,
  actorCheck,
  getBrandCollection,
  getBrandSettingDoc,
  normalizeStoreCore,
  getInitialPasswordsForRole,
}) {
  const orgRef = getBrandSettingDoc(db, brandId, "org_structure");
  const authRef = getBrandSettingDoc(db, brandId, "manager_auth");

  const [orgSnap, authSnap] = await Promise.all([
    transaction.get(orgRef),
    transaction.get(authRef),
  ]);

  if (!orgSnap.exists) throw new ManagerOrganizationAuthorityError("organization_missing", 404);
  const organizationRaw = orgSnap.data() || {};
  const managerAuthRaw = authSnap.exists ? (authSnap.data() || {}) : {};

  const previousOrganizationSignature = assertExpectedSignature(
    expectedOrganizationSignature,
    organizationRaw
  );

  const result = applyManagerOrganizationAction({
    action,
    targetManagerName,
    payload,
    organizationRaw,
    managerAuthRaw,
    brandId,
    nowText,
    normalizeStoreCore,
    getInitialPasswordsForRole,
  });

  const nextOrganization = {
    ...organizationRaw,
    managers: result.managers,
    managerOrder: result.managerOrder,
  };
  const nextOrganizationSignature = buildManagerOrganizationSignature(nextOrganization);

  transaction.set(orgRef, nextOrganization, { merge: false });
  transaction.set(authRef, result.managerAuth, { merge: false });

  const snapshotRef = getBrandCollection(db, brandId, "org_structure_snapshots").doc();
  transaction.set(snapshotRef, {
    brandId,
    action: `manager_${action}`,
    managers: cloneManagers(organizationRaw.managers || {}),
    managerKeys: Object.keys(cloneManagers(organizationRaw.managers || {})),
    managerOrder: normalizeManagerOrder(
      cloneManagers(organizationRaw.managers || {}),
      organizationRaw.managerOrder || []
    ),
    storeCount: Object.values(cloneManagers(organizationRaw.managers || {}))
      .flat()
      .filter(Boolean).length,
    operator: String(actorCheck?.actorName || actorCheck?.actorAccountId || "最高管理者"),
    operatorRole: "director",
    targetManagerName: String(targetManagerName || ""),
    nextManagerName: result.nextName || "",
    createdAtText: nowText,
    source: MANAGER_ORGANIZATION_AUTHORITY_VERSION,
    organizationSignature: previousOrganizationSignature,
  }, { merge: false });

  const maintenanceRef = getBrandCollection(db, brandId, "maintenance_logs").doc();
  transaction.set(maintenanceRef, {
    type: "org_structure_snapshot",
    action: `manager_${action}`,
    brandId,
    operator: String(actorCheck?.actorName || actorCheck?.actorAccountId || "最高管理者"),
    operatorRole: "director",
    createdAtText: nowText,
    details: action === "create"
      ? `新增區長 ${result.accountId}`
      : action === "delete"
        ? `刪除區長 ${result.previousName}，底下店家移至未分配`
        : result.previousName !== result.nextName
          ? `區長 ${result.previousName} 改名為 ${result.nextName}，並更新轄區`
          : `更新區長 ${result.accountId} 轄區`,
    source: MANAGER_ORGANIZATION_AUTHORITY_VERSION,
  }, { merge: false });

  const auditRef = getBrandCollection(db, brandId, "system_logs").doc();
  transaction.set(auditRef, {
    createdAtText: nowText,
    activityType: "organization.manager_management",
    action: "區長架構管理",
    role: "director",
    user: String(actorCheck?.actorName || actorCheck?.actorAccountId || "最高管理者"),
    brand: brandId,
    details: {
      managedAction: action,
      targetManagerName: String(targetManagerName || ""),
      resultManagerName: result.accountId,
      deleted: result.deleted === true,
      releasedStoreCount: result.storesMovedToUnassigned.length,
      organizationSignatureBefore: previousOrganizationSignature,
      organizationSignatureAfter: nextOrganizationSignature,
    },
  }, { merge: false });

  return {
    ...result,
    previousOrganizationSignature,
    organizationSignature: nextOrganizationSignature,
  };
}

function createManagerOrganizationAuthorityFunctions({
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
  ].forEach((fn, index) => {
    if (typeof fn !== "function") throw new Error(`missing_dependency_${index}`);
  });

  const manageManagerOrganization = onRequest({
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
      const normalizedByResolver = normalizeBrandId(requestedBrand);
      if (normalizedByResolver !== brandId) {
        throw new ManagerOrganizationAuthorityError("invalid_brand", 400);
      }

      const action = normalizeText(body.action, 32).toLowerCase();
      if (!SUPPORTED_MANAGER_ORGANIZATION_ACTIONS.has(action)) {
        throw new ManagerOrganizationAuthorityError("unsupported_manager_org_action", 400);
      }

      const actor = body.actor || {};
      assertAdminApplicationClaims(requestAuth, brandId, actor, {
        actorAccountId: actor?.accountId,
      });

      const actorCheck = await verifySuperAdminActor({ db, brandId, actor });
      if (!actorCheck?.ok) {
        throw new ManagerOrganizationAuthorityError("super_admin_reverification_required", 403);
      }
      assertAdminApplicationClaims(requestAuth, brandId, actor, actorCheck);

      const expectedOrganizationSignature = normalizeText(
        body.expectedOrganizationSignature,
        128
      );
      if (!expectedOrganizationSignature) {
        throw new ManagerOrganizationAuthorityError("organization_signature_required", 400);
      }

      const targetManagerName = normalizeText(
        body.managerName || body.accountId || "",
        120
      );
      const payload = body.payload && typeof body.payload === "object" ? body.payload : {};
      const nowText = new Date().toISOString();

      const result = await db.runTransaction(async (transaction) => (
        manageManagerOrganizationInTransaction({
          transaction,
          db,
          brandId,
          action,
          targetManagerName,
          payload,
          expectedOrganizationSignature,
          nowText,
          actorCheck,
          getBrandCollection,
          getBrandSettingDoc,
          normalizeStoreCore,
          getInitialPasswordsForRole,
        })
      ));

      return res.status(200).json({
        ok: true,
        changed: true,
        brandId,
        action,
        managerName: result.accountId,
        deleted: result.deleted === true,
        requiresInitialPasswordChange: result.requiresInitialPasswordChange === true,
        releasedStoreCount: result.storesMovedToUnassigned.length,
        organizationSignature: result.organizationSignature,
        updatedAtText: nowText,
      });
    } catch (error) {
      const status = Number(error?.status || 500);
      const code = String(error?.code || "manager_organization_failed");
      if (status >= 500) console.error("manageManagerOrganization failed", code);
      return res.status(status).json({
        ok: false,
        code,
        ...(error?.currentOrganizationSignature
          ? { currentOrganizationSignature: error.currentOrganizationSignature }
          : {}),
      });
    }
  });

  return { manageManagerOrganization };
}

module.exports = {
  MANAGER_ORGANIZATION_AUTHORITY_VERSION,
  UNASSIGNED_MANAGER_KEY,
  ManagerOrganizationAuthorityError,
  createManagerOrganizationAuthorityFunctions,
  buildManagerOrganizationSignature,
  normalizeManagerOrder,
  cloneManagers,
  buildStoreIndex,
  resolveRequestedStores,
  applyManagerOrganizationAction,
  manageManagerOrganizationInTransaction,
};

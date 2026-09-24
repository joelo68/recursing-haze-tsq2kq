const crypto = require("node:crypto");

const MANAGEMENT_DELEGATION_AUTHORITY_VERSION = "management-delegation-authority-v1";
const DELEGATION_SCHEMA_VERSION = "delegation-v1";
const AUTHORITY_STATE_DOC_ID = "state";
const SUPPORTED_ACTIONS = new Set(["create", "update", "end"]);
const DEFAULT_PERMISSIONS = Object.freeze({
  viewOperations: true,
  editReports: true,
  editHistory: true,
  deleteReports: false,
  receiveAlerts: true,
  manageTasks: true,
  editTargets: false,
  editOrganization: false,
});
const RESERVED_OBJECT_KEYS = new Set(["__proto__", "prototype", "constructor"]);

class ManagementDelegationAuthorityError extends Error {
  constructor(code, status = 400, extra = {}) {
    super(code);
    this.code = code;
    this.status = status;
    Object.assign(this, extra || {});
  }
}

function normalizeText(value = "", max = 240) {
  return String(value ?? "").trim().slice(0, max);
}

function assertSupportedBrandId(value = "") {
  const brandId = normalizeText(value, 24).toLowerCase();
  if (!["cyj", "anniu", "yibo"].includes(brandId)) {
    throw new ManagementDelegationAuthorityError("invalid_brand", 400);
  }
  return brandId;
}

function normalizeDelegationStoreCore(value = "") {
  let core = String(value || "")
    .trim()
    .replace(/[　\s]+/g, "")
    .replace(/[（）()]/g, "")
    .replace(/臺/g, "台")
    .replace(/^DR\.?(?:CYJ)?/i, "CYJ")
    .replace(/^(CYJ|Anew安妞|Yibo伊啵|Anew|Yibo|Ann|安妞|伊啵)/i, "")
    .trim();

  if (!core) return "";
  if (core === "新" || /^新店店?$/.test(core)) return "新店";
  return core.replace(/店+$/g, "").trim();
}

function normalizeTextKey(value = "") {
  return String(value || "")
    .trim()
    .toLocaleLowerCase("zh-Hant")
    .replace(/[　\s\-_/()（）.]/g, "");
}

function normalizeStoreList(values = []) {
  const list = Array.isArray(values) ? values : [];
  const seen = new Set();
  const rows = [];
  list.forEach((value) => {
    const core = normalizeDelegationStoreCore(value);
    if (!core || seen.has(core)) return;
    seen.add(core);
    rows.push(core);
  });
  return rows.slice(0, 256);
}

function normalizeDateString(value = "") {
  const text = normalizeText(value, 32).replace(/\//g, "-");
  const match = text.match(/^(20\d{2})-(\d{1,2})-(\d{1,2})$/);
  if (!match) return "";
  return `${match[1]}-${String(match[2]).padStart(2, "0")}-${String(match[3]).padStart(2, "0")}`;
}

function getTaipeiDateString(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function normalizePermissions(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const next = {};
  Object.keys(DEFAULT_PERMISSIONS).forEach((key) => {
    next[key] = key === "editOrganization"
      ? false
      : (Object.prototype.hasOwnProperty.call(source, key)
        ? Boolean(source[key])
        : DEFAULT_PERMISSIONS[key]);
  });
  return next;
}

function normalizeComparableDelegation(raw = {}, id = "") {
  const source = raw && typeof raw === "object" ? raw : {};
  return {
    id: normalizeText(id || source.id, 180),
    schemaVersion: normalizeText(source.schemaVersion || DELEGATION_SCHEMA_VERSION, 64),
    type: source.type === "store_manager" ? "store_manager" : "regional_manager",
    principalRole: normalizeText(source.principalRole || "", 32).toLowerCase(),
    principalId: normalizeText(source.principalId || "", 180),
    principalName: normalizeText(source.principalName || "", 180),
    delegateRole: normalizeText(source.delegateRole || "", 32).toLowerCase(),
    delegateId: normalizeText(source.delegateId || "", 180),
    delegateName: normalizeText(source.delegateName || "", 180),
    scopeMode: source.scopeMode === "selected_stores" ? "selected_stores" : "all_assigned_stores",
    storeNames: normalizeStoreList(source.storeNames || []),
    principalStoreSnapshot: normalizeStoreList(source.principalStoreSnapshot || []),
    startDate: normalizeDateString(source.startDate),
    endDate: normalizeDateString(source.endDate),
    status: normalizeText(source.status || "", 32).toLowerCase(),
    permissions: normalizePermissions(source.permissions || {}),
    reason: normalizeText(source.reason || "", 1000),
    endedEarly: source.endedEarly === true,
    endedAtText: normalizeText(source.endedAtText || "", 64),
    createdAtText: normalizeText(source.createdAtText || "", 64),
    updatedAtText: normalizeText(source.updatedAtText || "", 64),
  };
}

function buildDelegationSemanticSignature(raw = {}, id = "") {
  return crypto.createHash("sha256")
    .update(JSON.stringify(normalizeComparableDelegation(raw, id)))
    .digest("hex");
}

function assertExpectedDelegationSnapshot(expectedRaw, currentRaw, id) {
  if (!expectedRaw || typeof expectedRaw !== "object") {
    throw new ManagementDelegationAuthorityError("delegation_snapshot_required", 400);
  }
  const expectedSignature = buildDelegationSemanticSignature(expectedRaw, id);
  const currentSignature = buildDelegationSemanticSignature(currentRaw, id);
  if (expectedSignature !== currentSignature) {
    throw new ManagementDelegationAuthorityError("delegation_conflict", 409, {
      currentDelegation: { id, ...(currentRaw || {}) },
      currentDelegationSignature: currentSignature,
    });
  }
  return currentSignature;
}

function normalizeDelegationId(value = "") {
  const id = normalizeText(value, 180);
  if (!id || id.includes("/") || RESERVED_OBJECT_KEYS.has(id.toLowerCase())) {
    throw new ManagementDelegationAuthorityError("invalid_delegation_id", 400);
  }
  return id;
}

function cloneOrganizationManagers(raw = {}) {
  const managers = raw?.managers && typeof raw.managers === "object" && !Array.isArray(raw.managers)
    ? raw.managers
    : {};
  const next = {};
  Object.entries(managers).forEach(([rawName, rawStores]) => {
    const name = normalizeText(rawName, 180);
    if (!name || RESERVED_OBJECT_KEYS.has(name.toLowerCase())) return;
    next[name] = normalizeStoreList(Array.isArray(rawStores) ? rawStores : []);
  });
  return next;
}

function normalizeStoreAccounts(raw = {}) {
  const source = raw && typeof raw === "object" ? raw : {};
  const accounts = Array.isArray(source.accounts) ? source.accounts : [];
  return accounts
    .map((account) => ({
      ...(account && typeof account === "object" ? account : {}),
      id: normalizeText(account?.id || account?.accountId || account?.name, 180),
      name: normalizeText(account?.name || account?.displayName || account?.id, 180),
      stores: normalizeStoreList(
        Array.isArray(account?.stores)
          ? account.stores
          : (account?.storeName ? [account.storeName] : [])
      ),
    }))
    .filter((account) => account.id || account.name);
}

function accountMatches(account = {}, id = "", name = "") {
  const targetId = normalizeTextKey(id);
  const targetName = normalizeTextKey(name);
  const candidateIds = [account?.id, account?.accountId, account?.uid]
    .map(normalizeTextKey)
    .filter(Boolean);
  const candidateNames = [account?.name, account?.displayName]
    .map(normalizeTextKey)
    .filter(Boolean);
  if (targetId && candidateIds.includes(targetId)) return true;
  if (targetName && candidateNames.includes(targetName)) return true;
  return false;
}

function resolvePrincipalStores({ role, id, name, managers, storeAccounts }) {
  if (role === "manager") {
    const matched = Object.keys(managers || {}).find(
      (managerName) => normalizeTextKey(managerName) === normalizeTextKey(name)
    );
    if (!matched || matched === "未分配") {
      throw new ManagementDelegationAuthorityError("principal_account_missing", 404);
    }
    return normalizeStoreList(managers[matched] || []);
  }

  const account = (storeAccounts || []).find((item) => accountMatches(item, id, name));
  if (!account) throw new ManagementDelegationAuthorityError("principal_account_missing", 404);
  return normalizeStoreList(account.stores || []);
}

function assertDelegateExists({ role, id, name, managers, storeAccounts }) {
  if (role === "manager") {
    const matched = Object.keys(managers || {}).find(
      (managerName) => managerName !== "未分配"
        && normalizeTextKey(managerName) === normalizeTextKey(name)
    );
    if (!matched) throw new ManagementDelegationAuthorityError("delegate_account_missing", 404);
    return;
  }
  const account = (storeAccounts || []).find((item) => accountMatches(item, id, name));
  if (!account) throw new ManagementDelegationAuthorityError("delegate_account_missing", 404);
}

function buildDelegationCandidate({
  payload,
  brandId,
  managers,
  storeAccounts,
  actorCheck,
  nowText,
  todayText,
  existingRaw = null,
}) {
  const source = payload && typeof payload === "object" ? payload : {};
  const type = source.type === "store_manager" ? "store_manager" : "regional_manager";
  const role = type === "store_manager" ? "store" : "manager";

  const principalId = normalizeText(source.principalId, 180);
  const principalName = normalizeText(source.principalName, 180);
  const delegateId = normalizeText(source.delegateId, 180);
  const delegateName = normalizeText(source.delegateName, 180);
  if (!principalId || !principalName) {
    throw new ManagementDelegationAuthorityError("principal_account_required", 400);
  }
  if (!delegateId || !delegateName) {
    throw new ManagementDelegationAuthorityError("delegate_account_required", 400);
  }
  if (
    normalizeTextKey(principalId || principalName) === normalizeTextKey(delegateId || delegateName)
  ) {
    throw new ManagementDelegationAuthorityError("same_principal_and_delegate", 400);
  }

  if (source.principalRole && normalizeText(source.principalRole, 32).toLowerCase() !== role) {
    throw new ManagementDelegationAuthorityError("principal_role_mismatch", 400);
  }
  if (source.delegateRole && normalizeText(source.delegateRole, 32).toLowerCase() !== role) {
    throw new ManagementDelegationAuthorityError("delegate_role_mismatch", 400);
  }

  const principalStores = resolvePrincipalStores({
    role,
    id: principalId,
    name: principalName,
    managers,
    storeAccounts,
  });
  if (principalStores.length === 0) {
    throw new ManagementDelegationAuthorityError("principal_has_no_stores", 400);
  }
  assertDelegateExists({
    role,
    id: delegateId,
    name: delegateName,
    managers,
    storeAccounts,
  });

  const scopeMode = source.scopeMode === "selected_stores"
    ? "selected_stores"
    : "all_assigned_stores";
  const requestedStores = scopeMode === "selected_stores"
    ? normalizeStoreList(source.storeNames || [])
    : [];
  if (scopeMode === "selected_stores" && requestedStores.length === 0) {
    throw new ManagementDelegationAuthorityError("selected_stores_required", 400);
  }

  const principalStoreSet = new Set(principalStores);
  const outside = requestedStores.filter((store) => !principalStoreSet.has(store));
  if (outside.length) {
    throw new ManagementDelegationAuthorityError("delegation_store_outside_principal_scope", 409, {
      outsideStores: outside,
    });
  }

  const startDate = normalizeDateString(source.startDate);
  const endDate = normalizeDateString(source.endDate);
  if (!startDate || !endDate) {
    throw new ManagementDelegationAuthorityError("delegation_dates_required", 400);
  }
  if (endDate < startDate) {
    throw new ManagementDelegationAuthorityError("delegation_date_range_invalid", 400);
  }

  const createdAtText = normalizeText(existingRaw?.createdAtText || source.createdAtText || nowText, 64);
  const createdBy = normalizeText(
    existingRaw?.createdBy || source.createdBy || actorCheck?.actorName || actorCheck?.actorAccountId || "最高管理者",
    180
  );

  return {
    ...(existingRaw && typeof existingRaw === "object" ? existingRaw : {}),
    schemaVersion: DELEGATION_SCHEMA_VERSION,
    type,
    brandId,
    brandLabel: normalizeText(source.brandLabel || existingRaw?.brandLabel || brandId, 120),
    principalRole: role,
    principalId,
    principalName,
    delegateRole: role,
    delegateId,
    delegateName,
    scopeMode,
    storeNames: requestedStores,
    principalStoreSnapshot: principalStores,
    startDate,
    endDate,
    status: startDate > todayText ? "scheduled" : "active",
    permissions: normalizePermissions(source.permissions || {}),
    reason: normalizeText(source.reason || "", 1000),
    updatedBy: String(actorCheck?.actorName || actorCheck?.actorAccountId || "最高管理者"),
    updatedByRole: "director",
    updatedByUid: normalizeText(actorCheck?.actorUid || "", 180),
    updatedAtText: nowText,
    createdBy,
    createdByRole: normalizeText(existingRaw?.createdByRole || source.createdByRole || "director", 32),
    createdByUid: normalizeText(existingRaw?.createdByUid || source.createdByUid || "", 180),
    createdAtText,
    endedEarly: false,
    endedAtText: "",
  };
}

function resolveDelegationStores(raw = {}, managers = {}, storeAccounts = []) {
  const item = normalizeComparableDelegation(raw, raw?.id);
  if (item.scopeMode === "selected_stores" && item.storeNames.length > 0) return item.storeNames;

  if (item.principalRole === "manager" || item.type === "regional_manager") {
    const matched = Object.keys(managers || {}).find(
      (name) => normalizeTextKey(name) === normalizeTextKey(item.principalName)
    );
    const stores = matched ? normalizeStoreList(managers[matched] || []) : [];
    if (stores.length) return stores;
  } else if (item.principalRole === "store" || item.type === "store_manager") {
    const account = (storeAccounts || []).find(
      (row) => accountMatches(row, item.principalId, item.principalName)
    );
    const stores = account ? normalizeStoreList(account.stores || []) : [];
    if (stores.length) return stores;
  }

  return normalizeStoreList(item.principalStoreSnapshot || []);
}

function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  return Boolean(aStart && aEnd && bStart && bEnd) && aStart <= bEnd && bStart <= aEnd;
}

function assertNoDelegationConflict({
  candidate,
  existingRows,
  managers,
  storeAccounts,
  excludeId = "",
}) {
  const candidateStores = new Set(resolveDelegationStores(candidate, managers, storeAccounts));
  if (candidateStores.size === 0) {
    throw new ManagementDelegationAuthorityError("principal_has_no_stores", 400);
  }

  for (const row of existingRows || []) {
    const id = normalizeText(row?.id, 180);
    if (id && id === excludeId) continue;
    const item = normalizeComparableDelegation(row, id);
    if (["ended", "cancelled", "inactive"].includes(item.status)) continue;
    if (item.endedAtText || item.endedEarly === true) continue;
    if (!rangesOverlap(candidate.startDate, candidate.endDate, item.startDate, item.endDate)) continue;

    const overlapStores = resolveDelegationStores(item, managers, storeAccounts)
      .filter((store) => candidateStores.has(store));
    if (overlapStores.length) {
      throw new ManagementDelegationAuthorityError("delegation_overlap_conflict", 409, {
        conflictDelegationId: id,
        overlapStores: overlapStores.slice(0, 32),
      });
    }
  }
}

function buildMaintenanceDetails(action, delegation) {
  if (action === "end") {
    return `立即結束 ${delegation.delegateName} 代理 ${delegation.principalName}`;
  }
  return action === "create"
    ? `建立 ${delegation.delegateName} 代理 ${delegation.principalName}`
    : `更新 ${delegation.delegateName} 代理 ${delegation.principalName}`;
}

async function manageManagementDelegationInTransaction({
  transaction,
  db,
  brandId,
  action,
  delegationId,
  payload,
  expectedDelegation,
  actorCheck,
  nowText,
  todayText,
  getBrandCollection,
  getBrandSettingDoc,
  serverTimestamp,
}) {
  const delegationCollection = getBrandCollection(db, brandId, "management_delegations");
  const authorityRef = getBrandCollection(db, brandId, "management_delegation_authority")
    .doc(AUTHORITY_STATE_DOC_ID);
  const orgRef = getBrandSettingDoc(db, brandId, "org_structure");
  const storeAccountsRef = getBrandSettingDoc(db, brandId, "store_account_data");
  const delegationRef = delegationCollection.doc(delegationId);

  // A shared authority-state document is deliberately read/written by every delegation mutation.
  // This serializes different delegation IDs too, so concurrent overlapping creates cannot both commit.
  const refs = [authorityRef, orgRef, storeAccountsRef, delegationRef];
  const [authoritySnap, orgSnap, storeAccountsSnap, targetSnap] = await Promise.all(
    refs.map((ref) => transaction.get(ref))
  );

  if (!orgSnap.exists) throw new ManagementDelegationAuthorityError("organization_missing", 404);
  if (!storeAccountsSnap.exists) {
    throw new ManagementDelegationAuthorityError("store_account_source_missing", 404);
  }

  const authorityRaw = authoritySnap.exists ? (authoritySnap.data() || {}) : {};
  const previousRevision = Math.max(0, Number(authorityRaw.revision || 0));
  const managers = cloneOrganizationManagers(orgSnap.data() || {});
  const storeAccounts = normalizeStoreAccounts(storeAccountsSnap.data() || {});

  let nextDelegation;
  if (action === "create") {
    if (targetSnap.exists) {
      throw new ManagementDelegationAuthorityError("delegation_already_exists", 409);
    }
    nextDelegation = buildDelegationCandidate({
      payload,
      brandId,
      managers,
      storeAccounts,
      actorCheck,
      nowText,
      todayText,
    });
  } else {
    if (!targetSnap.exists) throw new ManagementDelegationAuthorityError("delegation_missing", 404);
    const currentRaw = targetSnap.data() || {};
    assertExpectedDelegationSnapshot(expectedDelegation, currentRaw, delegationId);

    if (action === "end") {
      const current = normalizeComparableDelegation(currentRaw, delegationId);
      if (
        ["ended", "cancelled"].includes(current.status)
        || current.endedEarly === true
        || current.endedAtText
      ) {
        throw new ManagementDelegationAuthorityError("delegation_already_ended", 409);
      }
      nextDelegation = {
        ...currentRaw,
        status: "ended",
        endedEarly: true,
        endedAt: serverTimestamp(),
        endedAtText: nowText,
        endedBy: String(actorCheck?.actorName || actorCheck?.actorAccountId || "最高管理者"),
        endedByRole: "director",
        updatedAt: serverTimestamp(),
        updatedAtText: nowText,
        updatedBy: String(actorCheck?.actorName || actorCheck?.actorAccountId || "最高管理者"),
        updatedByRole: "director",
      };
    } else {
      const current = normalizeComparableDelegation(currentRaw, delegationId);
      if (
        ["ended", "cancelled"].includes(current.status)
        || current.endedEarly === true
        || current.endedAtText
      ) {
        throw new ManagementDelegationAuthorityError("ended_delegation_not_editable", 409);
      }
      nextDelegation = buildDelegationCandidate({
        payload,
        brandId,
        managers,
        storeAccounts,
        actorCheck,
        nowText,
        todayText,
        existingRaw: currentRaw,
      });
    }
  }

  if (action !== "end") {
    const activeQuery = delegationCollection.where("status", "in", ["active", "scheduled"]);
    const activeSnap = await transaction.get(activeQuery);
    const existingRows = activeSnap.docs.map((docSnap) => ({
      id: docSnap.id,
      ...(docSnap.data() || {}),
    }));
    assertNoDelegationConflict({
      candidate: nextDelegation,
      existingRows,
      managers,
      storeAccounts,
      excludeId: action === "update" ? delegationId : "",
    });
  }

  const timestamp = serverTimestamp();
  if (action === "create") {
    transaction.set(delegationRef, {
      ...nextDelegation,
      createdAt: timestamp,
      updatedAt: timestamp,
    }, { merge: false });
  } else if (action === "update") {
    transaction.set(delegationRef, {
      ...nextDelegation,
      updatedAt: timestamp,
    }, { merge: false });
  } else {
    transaction.set(delegationRef, nextDelegation, { merge: true });
  }

  const nextRevision = previousRevision + 1;
  transaction.set(authorityRef, {
    schemaVersion: MANAGEMENT_DELEGATION_AUTHORITY_VERSION,
    brandId,
    revision: nextRevision,
    updatedAt: timestamp,
    updatedAtText: nowText,
    updatedBy: String(actorCheck?.actorName || actorCheck?.actorAccountId || "最高管理者"),
    updatedByRole: "director",
    lastAction: action,
    lastDelegationId: delegationId,
  }, { merge: true });

  const resolvedStores = resolveDelegationStores(nextDelegation, managers, storeAccounts);
  const maintenanceRef = getBrandCollection(db, brandId, "maintenance_logs").doc();
  transaction.set(maintenanceRef, {
    type: "management_delegation",
    action,
    delegationId,
    principalName: normalizeText(nextDelegation.principalName, 180),
    delegateName: normalizeText(nextDelegation.delegateName, 180),
    startDate: normalizeDateString(nextDelegation.startDate),
    endDate: normalizeDateString(nextDelegation.endDate),
    storeNames: resolvedStores,
    operator: String(actorCheck?.actorName || actorCheck?.actorAccountId || "最高管理者"),
    operatorRole: "director",
    brandId,
    source: MANAGEMENT_DELEGATION_AUTHORITY_VERSION,
    createdAt: timestamp,
    createdAtText: nowText,
    details: buildMaintenanceDetails(action, nextDelegation),
  }, { merge: false });

  const systemLogRef = getBrandCollection(db, brandId, "system_logs").doc();
  transaction.set(systemLogRef, {
    createdAt: timestamp,
    createdAtText: nowText,
    activityType: "organization.management_delegation",
    action: "代理與托管管理",
    role: "director",
    user: String(actorCheck?.actorName || actorCheck?.actorAccountId || "最高管理者"),
    brand: brandId,
    details: {
      managedAction: action,
      delegationId,
      principalName: normalizeText(nextDelegation.principalName, 180),
      delegateName: normalizeText(nextDelegation.delegateName, 180),
      storeCount: resolvedStores.length,
      authorityRevisionBefore: previousRevision,
      authorityRevisionAfter: nextRevision,
    },
  }, { merge: false });

  return {
    delegation: { id: delegationId, ...nextDelegation },
    authorityRevision: nextRevision,
    semanticSignature: buildDelegationSemanticSignature(nextDelegation, delegationId),
  };
}

function createManagementDelegationAuthorityFunctions({
  onRequest,
  db,
  runtimeServiceAccount,
  normalizeBrandId,
  getBrandCollection,
  getBrandSettingDoc,
  requireFirebaseRequestAuth,
  verifySuperAdminActor,
  assertAdminApplicationClaims,
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
    serverTimestamp,
  ].forEach((fn, index) => {
    if (typeof fn !== "function") throw new Error(`missing_dependency_${index}`);
  });

  const manageManagementDelegation = onRequest({
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
        throw new ManagementDelegationAuthorityError("invalid_brand", 400);
      }

      const action = normalizeText(body.action, 32).toLowerCase();
      if (!SUPPORTED_ACTIONS.has(action)) {
        throw new ManagementDelegationAuthorityError("unsupported_delegation_action", 400);
      }

      const actor = body.actor || {};
      assertAdminApplicationClaims(requestAuth, brandId, actor, {
        actorAccountId: actor?.accountId,
      });
      const actorCheck = await verifySuperAdminActor({ db, brandId, actor });
      if (!actorCheck?.ok) {
        throw new ManagementDelegationAuthorityError("super_admin_reverification_required", 403);
      }
      assertAdminApplicationClaims(requestAuth, brandId, actor, actorCheck);

      const delegationId = normalizeDelegationId(body.delegationId);
      const payload = body.payload && typeof body.payload === "object" ? body.payload : {};
      const expectedDelegation = body.expectedDelegation && typeof body.expectedDelegation === "object"
        ? body.expectedDelegation
        : null;
      if (action !== "create" && !expectedDelegation) {
        throw new ManagementDelegationAuthorityError("delegation_snapshot_required", 400);
      }

      const now = new Date();
      const nowText = now.toISOString();
      const todayText = getTaipeiDateString(now);

      const result = await db.runTransaction(async (transaction) => (
        manageManagementDelegationInTransaction({
          transaction,
          db,
          brandId,
          action,
          delegationId,
          payload,
          expectedDelegation,
          actorCheck,
          nowText,
          todayText,
          getBrandCollection,
          getBrandSettingDoc,
          serverTimestamp,
        })
      ));

      return res.status(200).json({
        ok: true,
        changed: true,
        brandId,
        action,
        delegationId,
        delegation: result.delegation,
        authorityRevision: result.authorityRevision,
        delegationSignature: result.semanticSignature,
        updatedAtText: nowText,
      });
    } catch (error) {
      const status = Number(error?.status || 500);
      const code = String(error?.code || "management_delegation_failed");
      if (status >= 500) console.error("manageManagementDelegation failed", code);
      return res.status(status).json({
        ok: false,
        code,
        ...(error?.currentDelegation ? { currentDelegation: error.currentDelegation } : {}),
        ...(error?.currentDelegationSignature
          ? { currentDelegationSignature: error.currentDelegationSignature }
          : {}),
        ...(Array.isArray(error?.overlapStores)
          ? { overlapStores: error.overlapStores }
          : {}),
        ...(error?.conflictDelegationId
          ? { conflictDelegationId: error.conflictDelegationId }
          : {}),
      });
    }
  });

  return { manageManagementDelegation };
}

module.exports = {
  MANAGEMENT_DELEGATION_AUTHORITY_VERSION,
  DELEGATION_SCHEMA_VERSION,
  AUTHORITY_STATE_DOC_ID,
  SUPPORTED_ACTIONS,
  DEFAULT_PERMISSIONS,
  ManagementDelegationAuthorityError,
  normalizeDelegationStoreCore,
  normalizeComparableDelegation,
  buildDelegationSemanticSignature,
  cloneOrganizationManagers,
  normalizeStoreAccounts,
  resolvePrincipalStores,
  buildDelegationCandidate,
  resolveDelegationStores,
  assertNoDelegationConflict,
  manageManagementDelegationInTransaction,
  createManagementDelegationAuthorityFunctions,
};

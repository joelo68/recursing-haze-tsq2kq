const crypto = require("crypto");

const APPLICATION_IDENTITY_VERSION = "application-identity-v1";
const APPLICATION_DIRECTORY_VERSION = "application-login-directory-v1";
const LOGIN_DIRECTORY_RUNTIME_SERVICE_ACCOUNT = "drcyj-login-directory@cyjsituation-analysis.iam.gserviceaccount.com";
const APPLICATION_DIRECTORY_BRANDS = Object.freeze(["cyj", "anniu", "yibo"]);
const APPLICATION_IDENTITY_ROLES = Object.freeze([
  "director",
  "trainer",
  "manager",
  "store",
  "therapist",
]);

function normalizeText(value = "", maxLength = 160) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function normalizeDirectoryBrandId(value = "") {
  const brandId = normalizeText(value, 24).toLowerCase();
  if (brandId === "default-app-id") return "cyj";
  return APPLICATION_DIRECTORY_BRANDS.includes(brandId) ? brandId : "";
}

function normalizeRoleId(value = "") {
  const roleId = normalizeText(value, 40).toLowerCase();
  return APPLICATION_IDENTITY_ROLES.includes(roleId) ? roleId : "";
}

function normalizeAccountId(value = "") {
  return normalizeText(value, 120);
}

function normalizeStores(value = []) {
  const source = Array.isArray(value) ? value : [value];
  return [...new Set(source.map((item) => normalizeText(item, 120)).filter(Boolean))].slice(0, 60);
}

function getDefaultDirectorLevel(name = "") {
  const text = normalizeText(name, 120);
  if (text.includes("董事長") || text.includes("總經理")) return "super_admin";
  if (text.includes("財務")) return "finance_admin";
  return "operation_admin";
}

function buildApplicationIdentityUid({ brandId = "", roleId = "", accountId = "" } = {}) {
  const brand = normalizeText(brandId, 24).toLowerCase() || "cyj";
  const role = normalizeRoleId(roleId) || "unknown";
  const account = normalizeAccountId(accountId) || "unknown";
  const digest = crypto
    .createHash("sha256")
    .update(`${brand}|${role}|${account}`)
    .digest("hex")
    .slice(0, 40);
  return `drcyj_${brand}_${role}_${digest}`.slice(0, 128);
}

function buildVerifiedApplicationIdentity({
  brandId = "",
  roleId = "",
  requestedAccountId = "",
  credential = {},
} = {}) {
  const brand = normalizeText(brandId, 24).toLowerCase() || "cyj";
  const role = normalizeRoleId(roleId);
  if (!role) throw new Error("unsupported_application_role");

  const accountId = normalizeAccountId(
    credential?.accountId || requestedAccountId
  );
  if (!accountId) throw new Error("missing_application_account");

  const userName = normalizeText(
    credential?.userName || requestedAccountId || accountId,
    120
  );
  const directorLevel = role === "director"
    ? normalizeText(credential?.directorLevel || getDefaultDirectorLevel(userName), 40)
    : "";
  const isMasterCredential = role === "director" && credential?.isMasterCredential === true;
  const stores = normalizeStores(credential?.stores || []);

  const uid = buildApplicationIdentityUid({ brandId: brand, roleId: role, accountId });
  const claims = {
    drcyjIdentity: true,
    identityVersion: APPLICATION_IDENTITY_VERSION,
    brandId: brand,
    roleId: role,
    accountId,
    ...(directorLevel ? { directorLevel } : {}),
  };

  return {
    uid,
    claims,
    identity: {
      version: APPLICATION_IDENTITY_VERSION,
      uid,
      brandId: brand,
      roleId: role,
      accountId,
      userName,
      ...(directorLevel ? { directorLevel } : {}),
      isMasterCredential,
      ...(stores.length ? { stores } : {}),
    },
  };
}

function normalizeDirectorDirectory(raw = {}) {
  const source = raw && typeof raw === "object" ? raw : {};
  const hasAccounts = source.accounts && typeof source.accounts === "object";
  const accounts = hasAccounts ? { ...source.accounts } : {};

  if (!hasAccounts) {
    Object.entries(source).forEach(([key, value]) => {
      if (["accounts", "directorOrder", "password"].includes(key)) return;
      if (value && typeof value === "object") {
        accounts[key] = { ...value, name: value.name || key };
      } else {
        accounts[key] = { id: key, name: key, isActive: true };
      }
    });
    if (source.password && !Object.keys(accounts).length) {
      accounts["營運總監"] = { id: "營運總監", name: "營運總監", isActive: true };
    }
  }

  const sourceOrder = Array.isArray(source.directorOrder)
    ? source.directorOrder.map((value) => normalizeText(value, 120)).filter(Boolean)
    : [];
  const ordered = [];
  const seen = new Set();

  sourceOrder.forEach((id) => {
    if (accounts[id] && !seen.has(id)) {
      seen.add(id);
      ordered.push(id);
    }
  });
  Object.keys(accounts)
    .filter((id) => !seen.has(id))
    .sort((a, b) => String(a).localeCompare(String(b), "zh-Hant", { numeric: true, sensitivity: "base" }))
    .forEach((id) => ordered.push(id));

  return ordered.map((key, index) => {
    const rawAccount = accounts[key];
    const account = rawAccount && typeof rawAccount === "object" ? rawAccount : {};
    const name = normalizeText(account.name || key, 120);
    return {
      id: normalizeAccountId(account.id || key),
      name,
      level: normalizeText(account.level || account.directorLevel || getDefaultDirectorLevel(name), 40),
      isActive: account.isActive !== false,
      sortOrder: Number.isFinite(Number(account.sortOrder)) ? Number(account.sortOrder) : index,
    };
  }).filter((item) => item.id && item.name);
}

function normalizeTrainerDirectory(raw = {}) {
  const source = raw && typeof raw === "object" ? raw : {};
  const legacyId = "trainer_default";
  const hasAccounts = source.accounts && typeof source.accounts === "object";
  const accounts = hasAccounts ? { ...source.accounts } : {};

  if (!hasAccounts || !Object.keys(accounts).length) {
    accounts[legacyId] = {
      id: legacyId,
      name: source.name || "教專",
      isActive: source.isActive !== false,
      isLegacyDefault: true,
    };
  }

  const sourceOrder = Array.isArray(source.trainerOrder)
    ? source.trainerOrder.map((value) => normalizeText(value, 120)).filter(Boolean)
    : [];
  const ordered = [];
  const seen = new Set();

  sourceOrder.forEach((id) => {
    if (accounts[id] && !seen.has(id)) {
      seen.add(id);
      ordered.push(id);
    }
  });
  Object.keys(accounts)
    .filter((id) => !seen.has(id))
    .sort((a, b) => String(accounts[a]?.name || a).localeCompare(String(accounts[b]?.name || b), "zh-Hant", { numeric: true, sensitivity: "base" }))
    .forEach((id) => ordered.push(id));

  return ordered.map((key, index) => {
    const rawAccount = accounts[key];
    const account = rawAccount && typeof rawAccount === "object" ? rawAccount : {};
    return {
      id: normalizeAccountId(account.id || key),
      name: normalizeText(account.name || (key === legacyId ? "教專" : key), 120),
      isActive: account.isActive !== false,
      sortOrder: Number.isFinite(Number(account.sortOrder)) ? Number(account.sortOrder) : index,
      isLegacyDefault: account.isLegacyDefault === true || (!hasAccounts && key === legacyId),
    };
  }).filter((item) => item.id && item.name);
}

function normalizeManagerDirectory(raw = {}) {
  const source = raw && typeof raw === "object" ? raw : {};
  return Object.entries(source)
    .map(([key, value]) => {
      const entry = value && typeof value === "object" ? value : {};
      const name = normalizeText(entry.name || key, 120);
      return {
        id: normalizeAccountId(entry.id || key),
        name,
        isActive: entry.isActive !== false,
      };
    })
    .filter((item) => item.id && item.name)
    .sort((a, b) => a.name.localeCompare(b.name, "zh-Hant", { numeric: true, sensitivity: "base" }));
}

function normalizeStoreDirectory(raw = {}) {
  const source = raw && typeof raw === "object" ? raw : {};
  const accounts = Array.isArray(source.accounts) ? source.accounts : [];
  return accounts.map((entry = {}) => {
    const stores = normalizeStores(
      Array.isArray(entry.stores) && entry.stores.length
        ? entry.stores
        : [entry.storeName || entry.store || ""]
    );
    return {
      id: normalizeAccountId(entry.id || entry.accountId || entry.name),
      name: normalizeText(entry.name || entry.id || "店經理", 120),
      stores,
      ...(stores[0] ? { storeName: stores[0] } : {}),
      isActive: entry.isActive !== false,
      status: normalizeText(entry.status || "", 40),
    };
  }).filter((item) => item.id && item.name);
}

function normalizeTherapistDirectoryRecord(id = "", raw = {}) {
  const source = raw && typeof raw === "object" ? raw : {};
  const stores = normalizeStores([
    ...(Array.isArray(source.stores) ? source.stores : []),
    source.store,
    source.storeName,
    source.primaryStore,
  ]);
  const primaryStore = normalizeText(
    source.store || source.storeName || source.primaryStore || stores[0] || "",
    120
  );
  return {
    id: normalizeAccountId(source.id || id),
    name: normalizeText(source.name || source.displayName || id, 120),
    ...(primaryStore ? { store: primaryStore, storeName: primaryStore, primaryStore } : {}),
    ...(stores.length ? { stores } : {}),
    manager: normalizeText(source.manager || source.managerName || "", 120),
    managerName: normalizeText(source.managerName || source.manager || "", 120),
    isActive: source.isActive !== false,
    status: normalizeText(source.status || "", 40),
    resigned: source.resigned === true,
    isResigned: source.isResigned === true,
    resignDate: normalizeText(source.resignDate || "", 24),
    inactiveDate: normalizeText(source.inactiveDate || "", 24),
    offboardDate: normalizeText(source.offboardDate || "", 24),
  };
}

function buildSanitizedLoginDirectory({
  brandId = "",
  directorAuth = {},
  trainerAuth = {},
  managerAuth = {},
  storeAccountData = {},
  therapists = [],
} = {}) {
  const brand = normalizeText(brandId, 24).toLowerCase() || "cyj";
  const therapistRows = (Array.isArray(therapists) ? therapists : [])
    .map((item) => normalizeTherapistDirectoryRecord(item?.id, item?.data || item))
    .filter((item) => item.id && item.name);

  return {
    version: APPLICATION_DIRECTORY_VERSION,
    brandId: brand,
    directors: normalizeDirectorDirectory(directorAuth),
    trainers: normalizeTrainerDirectory(trainerAuth),
    managers: normalizeManagerDirectory(managerAuth),
    stores: normalizeStoreDirectory(storeAccountData),
    therapists: therapistRows,
  };
}

function createApplicationIdentityFunctions({
  onRequest,
  db,
  normalizeBrandId,
  getBrandCollection,
  getBrandSettingDoc,
  requireFirebaseRequestAuth,
} = {}) {
  if (typeof onRequest !== "function") throw new Error("missing_onRequest");
  if (!db) throw new Error("missing_db");
  if (typeof normalizeBrandId !== "function") throw new Error("missing_normalizeBrandId");
  if (typeof getBrandCollection !== "function") throw new Error("missing_getBrandCollection");
  if (typeof getBrandSettingDoc !== "function") throw new Error("missing_getBrandSettingDoc");
  if (typeof requireFirebaseRequestAuth !== "function") throw new Error("missing_requireFirebaseRequestAuth");

  const getApplicationLoginDirectory = onRequest(
    {
      cors: true,
      timeoutSeconds: 20,
      memory: "256MiB",
      serviceAccount: LOGIN_DIRECTORY_RUNTIME_SERVICE_ACCOUNT,
    },
    async (req, res) => {
      if (req.method !== "POST") {
        return res.status(405).json({ ok: false, message: "method_not_allowed" });
      }

      const requestAuth = await requireFirebaseRequestAuth(req);
      if (!requestAuth?.ok) {
        return res.status(401).json({ ok: false, message: "登入狀態已失效，請重新整理後再試" });
      }

      try {
        const strictBrandId = normalizeDirectoryBrandId(req.body?.brandId);
        if (!strictBrandId) {
          return res.status(400).json({
            ok: false,
            code: "unsupported_brand",
            message: "品牌資料不正確，請重新整理後再試",
          });
        }

        const brandId = normalizeBrandId(strictBrandId);
        if (brandId !== strictBrandId) {
          throw new Error("directory_brand_resolver_mismatch");
        }

        const [
          storeAccountSnap,
          managerAuthSnap,
          trainerAuthSnap,
          directorAuthSnap,
          therapistsSnap,
        ] = await Promise.all([
          getBrandSettingDoc(db, brandId, "store_account_data").get(),
          getBrandSettingDoc(db, brandId, "manager_auth").get(),
          getBrandSettingDoc(db, brandId, "trainer_auth").get(),
          getBrandSettingDoc(db, brandId, "director_auth").get(),
          getBrandCollection(db, brandId, "therapists").get(),
        ]);

        const therapists = [];
        (therapistsSnap?.docs || []).forEach((docSnap) => {
          therapists.push({
            id: String(docSnap.id || ""),
            data: docSnap.data?.() || {},
          });
        });

        const directory = buildSanitizedLoginDirectory({
          brandId,
          storeAccountData: storeAccountSnap?.exists ? (storeAccountSnap.data?.() || {}) : {},
          managerAuth: managerAuthSnap?.exists ? (managerAuthSnap.data?.() || {}) : {},
          trainerAuth: trainerAuthSnap?.exists ? (trainerAuthSnap.data?.() || {}) : {},
          directorAuth: directorAuthSnap?.exists ? (directorAuthSnap.data?.() || {}) : {},
          therapists,
        });

        if (typeof res.set === "function") {
          res.set("Cache-Control", "private, no-store");
        }

        return res.status(200).json({
          ok: true,
          directory,
          counts: {
            directors: directory.directors.length,
            trainers: directory.trainers.length,
            managers: directory.managers.length,
            stores: directory.stores.length,
            therapists: directory.therapists.length,
          },
        });
      } catch (error) {
        console.error("getApplicationLoginDirectory failed", error);
        return res.status(500).json({
          ok: false,
          message: "登入名單暫時無法同步，請稍後再試",
        });
      }
    }
  );

  return { getApplicationLoginDirectory };
}

module.exports = {
  APPLICATION_IDENTITY_VERSION,
  APPLICATION_DIRECTORY_VERSION,
  LOGIN_DIRECTORY_RUNTIME_SERVICE_ACCOUNT,
  APPLICATION_DIRECTORY_BRANDS,
  normalizeDirectoryBrandId,
  buildApplicationIdentityUid,
  buildVerifiedApplicationIdentity,
  buildSanitizedLoginDirectory,
  normalizeDirectorDirectory,
  normalizeTrainerDirectory,
  normalizeManagerDirectory,
  normalizeStoreDirectory,
  normalizeTherapistDirectoryRecord,
  createApplicationIdentityFunctions,
};

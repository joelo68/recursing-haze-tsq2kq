const crypto = require("crypto");

const ADMINISTRATIVE_SETTINGS_RUNTIME_SERVICE_ACCOUNT =
  "drcyj-account-authority@cyjsituation-analysis.iam.gserviceaccount.com";

const ADMIN_ACTIONS = new Set([
  "update_security_config",
  "update_feature_flags",
  "update_kpi_targets",
  "publish_system_version",
]);

const SUPPORTED_ROLES = new Set(["director", "trainer", "manager", "store", "therapist"]);
const SECURITY_MODES = new Set(["off", "monitor", "enforce"]);

class AdministrativeSettingsAuthorityError extends Error {
  constructor(code, status = 400, details = {}) {
    super(code);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function normalizeText(value = "", maxLength = 240) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function normalizeBrandId(value = "") {
  const brandId = normalizeText(value, 24).toLowerCase();
  if (!["cyj", "anniu", "yibo"].includes(brandId)) {
    throw new AdministrativeSettingsAuthorityError("unsupported_brand", 400);
  }
  return brandId;
}

function normalizeRevision(value) {
  const revision = Number(value ?? 0);
  if (!Number.isInteger(revision) || revision < 0) {
    throw new AdministrativeSettingsAuthorityError("invalid_expected_revision", 400);
  }
  return revision;
}

function toFiniteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clampInteger(value, min, max, fallback) {
  const number = Math.trunc(toFiniteNumber(value, fallback));
  return Math.max(min, Math.min(max, number));
}

function normalizeSecurityConfig(payload = {}) {
  const autoLogoutEnabled = payload.autoLogoutEnabled !== false;
  const autoLogoutMinutes = clampInteger(
    payload.autoLogoutMinutes ?? payload.timeoutMinutes,
    1,
    1440,
    240
  );
  const logoutWarningSeconds = clampInteger(
    payload.logoutWarningSeconds ?? payload.warningSeconds,
    5,
    600,
    60
  );
  const lowPowerEnabled = payload.lowPowerEnabled !== false;
  const lowPowerIdleMinutes = clampInteger(payload.lowPowerIdleMinutes, 1, 1440, 30);
  const deviceApprovalMode = SECURITY_MODES.has(String(payload.deviceApprovalMode || ""))
    ? String(payload.deviceApprovalMode)
    : "off";
  const requestedRoles = Array.isArray(payload.deviceApprovalRoles)
    ? payload.deviceApprovalRoles.map((role) => String(role || "").trim()).filter(Boolean)
    : [];
  const deviceApprovalRoles = [...new Set(requestedRoles.filter((role) => SUPPORTED_ROLES.has(role)))];
  const exemptRoles = [...new Set(
    (Array.isArray(payload.exemptRoles) ? payload.exemptRoles : ["director", "master"])
      .map((role) => String(role || "").trim())
      .filter(Boolean)
  )];

  return {
    enabled: autoLogoutEnabled,
    timeoutMinutes: autoLogoutMinutes,
    warningSeconds: logoutWarningSeconds,
    exemptRoles,
    lowPowerEnabled,
    lowPowerIdleMinutes,
    autoLogoutEnabled,
    autoLogoutMinutes,
    logoutWarningSeconds,
    deviceApprovalMode,
    deviceApprovalRoles: deviceApprovalRoles.length
      ? deviceApprovalRoles
      : ["director", "trainer", "manager", "store", "therapist"],
    deviceApprovalExpiryMinutes: clampInteger(payload.deviceApprovalExpiryMinutes, 5, 60, 15),
    allowTrustedDeviceSelfApproval: payload.allowTrustedDeviceSelfApproval !== false,
  };
}

function normalizeFeatureFlags(payload = {}) {
  return {
    therapistModuleEnabled: payload.therapistModuleEnabled !== false,
  };
}

function normalizeBenchmarkNode(value, depth = 0) {
  if (depth > 6) throw new AdministrativeSettingsAuthorityError("benchmark_payload_too_deep", 400);
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new AdministrativeSettingsAuthorityError("invalid_benchmark_number", 400);
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > 100) throw new AdministrativeSettingsAuthorityError("benchmark_payload_too_large", 400);
    return value.map((item) => normalizeBenchmarkNode(item, depth + 1));
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value);
    if (entries.length > 100) throw new AdministrativeSettingsAuthorityError("benchmark_payload_too_large", 400);
    return Object.fromEntries(entries.map(([key, item]) => [
      normalizeText(key, 120),
      normalizeBenchmarkNode(item, depth + 1),
    ]));
  }
  throw new AdministrativeSettingsAuthorityError("invalid_benchmark_payload", 400);
}

const KPI_BENCHMARK_PROFILE_BY_BRAND = Object.freeze({
  cyj: "default",
  anniu: "安妞",
  yibo: "伊啵",
});

function normalizeKpiBenchmarks(value, brandId) {
  const normalized = normalizeBenchmarkNode(
    value && typeof value === "object" && !Array.isArray(value) ? value : {}
  );
  const profileKey = KPI_BENCHMARK_PROFILE_BY_BRAND[brandId] || "";
  if (!profileKey) {
    throw new AdministrativeSettingsAuthorityError("unsupported_brand", 400);
  }

  const profile = normalized?.[profileKey];
  if (profile === undefined) return normalized;
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
    throw new AdministrativeSettingsAuthorityError("invalid_benchmark_profile", 400);
  }

  for (const category of Object.values(profile)) {
    if (!category || typeof category !== "object" || Array.isArray(category)) continue;

    const hasMin = Object.prototype.hasOwnProperty.call(category, "min");
    const hasMax = Object.prototype.hasOwnProperty.call(category, "max");
    if (!hasMin && !hasMax) continue;
    if (!hasMin || !hasMax || typeof category.min === "boolean" || typeof category.max === "boolean") {
      throw new AdministrativeSettingsAuthorityError("invalid_benchmark_range", 400);
    }

    const min = Number(category.min);
    const max = Number(category.max);
    if (!Number.isFinite(min) || !Number.isFinite(max) || !(min > 0) || !(max > min)) {
      throw new AdministrativeSettingsAuthorityError("invalid_benchmark_range", 400);
    }

    category.min = min;
    category.max = max;
  }

  return normalized;
}

function normalizeKpiTargets(payload = {}, brandId = "") {
  const trafficASP = toFiniteNumber(payload.trafficASP, 1200);
  if (trafficASP < 0 || trafficASP > 1000000) {
    throw new AdministrativeSettingsAuthorityError("invalid_traffic_asp", 400);
  }

  const rawNewAsp = payload.newASP;
  const newASP = rawNewAsp === null || rawNewAsp === undefined || rawNewAsp === ""
    ? null
    : Number(rawNewAsp);
  if (newASP !== null && (!Number.isFinite(newASP) || newASP <= 0 || newASP > 10000000)) {
    throw new AdministrativeSettingsAuthorityError("invalid_new_asp", 400);
  }

  return {
    newASP,
    trafficASP,
    benchmarks: normalizeKpiBenchmarks(payload.benchmarks, brandId),
  };
}

function safeAuditDigest(value = {}) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 24);
}

async function updateRevisionedSetting({
  transaction,
  ref,
  expectedRevision,
  nextFields,
  deleteNewAsp = false,
  fieldValue,
}) {
  const snap = await transaction.get(ref);
  const current = snap.exists ? snap.data() || {} : {};
  const parsedRevision = Number(current.revision ?? 0);
  const currentRevision = Number.isInteger(parsedRevision) && parsedRevision >= 0 ? parsedRevision : 0;

  if (currentRevision !== expectedRevision) {
    throw new AdministrativeSettingsAuthorityError("setting_revision_conflict", 409, {
      currentRevision,
    });
  }

  const nextRevision = currentRevision + 1;
  const payload = {
    ...nextFields,
    revision: nextRevision,
    updatedAt: fieldValue.serverTimestamp(),
    updatedAtText: new Date().toISOString(),
  };
  if (deleteNewAsp) payload.newASP = fieldValue.delete();

  transaction.set(ref, payload, { merge: true });
  return { currentRevision, nextRevision };
}

function createAdministrativeSettingsAuthorityFunctions({
  onRequest,
  admin,
  db,
  getBrandCollection,
  getBrandSettingDoc,
  requireFirebaseRequestAuth,
  verifySuperAdminActor,
  assertAdminApplicationClaims,
}) {
  const manageAdministrativeSetting = onRequest({
    cors: true,
    timeoutSeconds: 20,
    memory: "256MiB",
    serviceAccount: ADMINISTRATIVE_SETTINGS_RUNTIME_SERVICE_ACCOUNT,
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
      const brandId = normalizeBrandId(body.brandId);
      const action = normalizeText(body.action, 80).toLowerCase();
      const payload = body.payload && typeof body.payload === "object" ? body.payload : {};
      const actor = body.actor && typeof body.actor === "object" ? body.actor : {};
      const expectedRevision = normalizeRevision(body.expectedRevision);

      if (!ADMIN_ACTIONS.has(action)) {
        throw new AdministrativeSettingsAuthorityError("unsupported_admin_setting_action", 400);
      }

      assertAdminApplicationClaims(requestAuth, brandId, actor, {
        actorAccountId: actor?.accountId,
      });
      const actorCheck = await verifySuperAdminActor({ db, brandId, actor });
      if (!actorCheck?.ok) {
        throw new AdministrativeSettingsAuthorityError("super_admin_reverification_required", 403);
      }
      assertAdminApplicationClaims(requestAuth, brandId, actor, actorCheck);

      const fieldValue = admin.firestore.FieldValue;
      const nowText = new Date().toISOString();

      if (action === "publish_system_version") {
        const version = normalizeText(payload.version, 40);
        if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
          throw new AdministrativeSettingsAuthorityError("invalid_system_version", 400);
        }

        const versionRef = db.doc("artifacts/default-app-id/public/data/global_settings/system_version");
        const result = await db.runTransaction(async (transaction) => {
          const snap = await transaction.get(versionRef);
          const currentVersion = snap.exists ? normalizeText(snap.data()?.version, 40) : "";
          if (currentVersion === version) {
            return { changed: false, version, currentVersion };
          }
          transaction.set(versionRef, {
            version,
            updatedAt: fieldValue.serverTimestamp(),
            updatedAtText: nowText,
            updatedBy: String(actorCheck.actorName || actorCheck.actorAccountId || "最高管理者"),
            updatedByAccountId: String(actorCheck.actorAccountId || ""),
          }, { merge: true });
          return { changed: true, version, currentVersion };
        });

        await getBrandCollection(db, brandId, "maintenance_logs").add({
          type: "administrative_setting",
          action,
          changed: result.changed === true,
          version,
          actor: String(actorCheck.actorName || actorCheck.actorAccountId || "最高管理者"),
          actorAccountId: String(actorCheck.actorAccountId || ""),
          createdAt: fieldValue.serverTimestamp(),
          createdAtText: nowText,
        });

        return res.status(200).json({
          ok: true,
          brandId,
          action,
          changed: result.changed === true,
          version,
        });
      }

      const targetByAction = {
        update_security_config: "security_config",
        update_feature_flags: "feature_flags",
        update_kpi_targets: "kpi_targets",
      };
      const settingId = targetByAction[action];
      const settingRef = getBrandSettingDoc(db, brandId, settingId);

      let normalizedPayload = {};
      if (action === "update_security_config") normalizedPayload = normalizeSecurityConfig(payload);
      if (action === "update_feature_flags") normalizedPayload = normalizeFeatureFlags(payload);
      if (action === "update_kpi_targets") normalizedPayload = normalizeKpiTargets(payload, brandId);

      const result = await db.runTransaction(async (transaction) => {
        if (action === "update_kpi_targets") {
          const { newASP, ...rest } = normalizedPayload;
          return updateRevisionedSetting({
            transaction,
            ref: settingRef,
            expectedRevision,
            nextFields: {
              ...rest,
              ...(newASP !== null ? { newASP } : {}),
              updatedBy: String(actorCheck.actorName || actorCheck.actorAccountId || "最高管理者"),
              updatedByRole: String(actorCheck.actorRole || "director"),
            },
            deleteNewAsp: newASP === null,
            fieldValue,
          });
        }

        return updateRevisionedSetting({
          transaction,
          ref: settingRef,
          expectedRevision,
          nextFields: {
            ...normalizedPayload,
            updatedBy: String(actorCheck.actorName || actorCheck.actorAccountId || "最高管理者"),
            updatedByRole: String(actorCheck.actorRole || "director"),
          },
          fieldValue,
        });
      });

      await getBrandCollection(db, brandId, "maintenance_logs").add({
        type: "administrative_setting",
        action,
        settingId,
        revision: result.nextRevision,
        payloadDigest: safeAuditDigest(normalizedPayload),
        actor: String(actorCheck.actorName || actorCheck.actorAccountId || "最高管理者"),
        actorAccountId: String(actorCheck.actorAccountId || ""),
        createdAt: fieldValue.serverTimestamp(),
        createdAtText: nowText,
      });

      return res.status(200).json({
        ok: true,
        changed: true,
        brandId,
        action,
        settingId,
        revision: result.nextRevision,
      });
    } catch (error) {
      const status = Number(error?.status || 500);
      const code = String(error?.code || "administrative_setting_failed");
      if (status >= 500) console.error("manageAdministrativeSetting failed", code, error);
      return res.status(status).json({
        ok: false,
        code,
        ...(error?.details && typeof error.details === "object" ? error.details : {}),
      });
    }
  });

  return { manageAdministrativeSetting };
}

module.exports = {
  ADMINISTRATIVE_SETTINGS_RUNTIME_SERVICE_ACCOUNT,
  AdministrativeSettingsAuthorityError,
  normalizeSecurityConfig,
  normalizeFeatureFlags,
  normalizeKpiTargets,
  createAdministrativeSettingsAuthorityFunctions,
};

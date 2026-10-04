// src/utils/directorPermissions.js

export const DIRECTOR_LEVEL_OPTIONS = Object.freeze([
  Object.freeze({ id: "super_admin", label: "最高管理者", editable: false }),
  Object.freeze({ id: "operation_admin", label: "營運管理", editable: true }),
  Object.freeze({ id: "finance_admin", label: "財務管理", editable: true }),
  Object.freeze({ id: "viewer", label: "僅查看", editable: true }),
]);

export const DIRECTOR_LEVEL_OPTIONS_BY_ID = Object.freeze(
  Object.fromEntries(DIRECTOR_LEVEL_OPTIONS.map((item) => [item.id, item]))
);

export const DIRECTOR_PERMISSION_REQUIRED_VIEW_IDS = Object.freeze(["dashboard"]);
export const DIRECTOR_PERMISSION_SUPER_ADMIN_ONLY_VIEW_IDS = Object.freeze(["settings"]);

export const DEFAULT_DIRECTOR_LEVEL_PERMISSIONS = Object.freeze({
  operation_admin: Object.freeze([
    "dashboard",
    "daily",
    "regional",
    "ranking",
    "store-analysis",
    "audit",
    "annual",
    "smart-forecast",
    "logs",
    "notification",
  ]),
  finance_admin: Object.freeze([
    "dashboard",
    "daily",
    "regional",
    "ranking",
    "store-analysis",
    "annual",
    "smart-forecast",
  ]),
  viewer: Object.freeze([
    "dashboard",
    "daily",
    "regional",
    "ranking",
    "store-analysis",
    "annual",
  ]),
});

const EDITABLE_DIRECTOR_LEVEL_IDS = Object.freeze([
  "operation_admin",
  "finance_admin",
  "viewer",
]);

const normalizePermissionId = (value = "") => {
  const id = String(value || "").trim();
  return /^[a-z0-9][a-z0-9-]{0,63}$/.test(id) ? id : "";
};

export const normalizeDirectorLevelPermissionMap = (raw = {}) => {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const superAdminOnly = new Set(DIRECTOR_PERMISSION_SUPER_ADMIN_ONLY_VIEW_IDS);

  return Object.fromEntries(
    EDITABLE_DIRECTOR_LEVEL_IDS.map((levelId) => {
      const configured = Array.isArray(source[levelId])
        ? source[levelId]
        : DEFAULT_DIRECTOR_LEVEL_PERMISSIONS[levelId];

      const normalized = [...new Set(
        configured
          .map(normalizePermissionId)
          .filter(Boolean)
          .filter((viewId) => !superAdminOnly.has(viewId))
      )];

      DIRECTOR_PERMISSION_REQUIRED_VIEW_IDS.forEach((viewId) => {
        if (!normalized.includes(viewId)) normalized.unshift(viewId);
      });

      return [levelId, normalized];
    })
  );
};

export const resolveDirectorLevelPermissionProfile = (permissions = {}, level = "operation_admin") => {
  const normalizedLevel = String(level || "").trim();
  const metadata = DIRECTOR_LEVEL_OPTIONS_BY_ID[normalizedLevel]
    || DIRECTOR_LEVEL_OPTIONS_BY_ID.operation_admin;

  if (normalizedLevel === "super_admin") {
    return {
      levelId: "super_admin",
      label: DIRECTOR_LEVEL_OPTIONS_BY_ID.super_admin.label,
      allowedViews: null,
    };
  }

  const map = normalizeDirectorLevelPermissionMap(permissions?.directorLevels || {});
  const levelId = metadata.id === "super_admin" ? "operation_admin" : metadata.id;

  return {
    levelId,
    label: DIRECTOR_LEVEL_OPTIONS_BY_ID[levelId]?.label || DIRECTOR_LEVEL_OPTIONS_BY_ID.operation_admin.label,
    allowedViews: new Set(map[levelId] || DEFAULT_DIRECTOR_LEVEL_PERMISSIONS.operation_admin),
  };
};

export const getDirectorLevelLabel = (level = "") => (
  DIRECTOR_LEVEL_OPTIONS_BY_ID[String(level || "").trim()]?.label
  || DIRECTOR_LEVEL_OPTIONS_BY_ID.operation_admin.label
);

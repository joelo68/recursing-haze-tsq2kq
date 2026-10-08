// src/config/runtimeEnvironment.js
// Activity Sales Center isolated-development boundary.
// Production behavior remains unchanged unless VITE_ACTIVITY_SALES_DEV=true.

const DEMO_PROJECT_ID = "demo-drcyj-activity-sales";
const LOCAL_HOST = "127.0.0.1";
const FUNCTION_REGION = "us-central1";

const readEnv = (key = "") => {
  if (typeof import.meta === "undefined" || !import.meta.env) return "";
  return String(import.meta.env[key] || "").trim();
};

export const ACTIVITY_SALES_DEV_MODE =
  readEnv("VITE_ACTIVITY_SALES_DEV").toLowerCase() === "true";

const requestedProjectId =
  readEnv("VITE_ACTIVITY_SALES_PROJECT_ID") || DEMO_PROJECT_ID;

if (ACTIVITY_SALES_DEV_MODE && !requestedProjectId.startsWith("demo-")) {
  throw new Error(
    "Activity Sales Center 開發模式只能使用 demo-* Firebase project，已阻止連線。"
  );
}

export const ACTIVITY_SALES_RUNTIME = Object.freeze({
  mode: ACTIVITY_SALES_DEV_MODE ? "activity-sales-local" : "production",
  projectId: ACTIVITY_SALES_DEV_MODE ? requestedProjectId : "",
  authEmulatorUrl: `http://${LOCAL_HOST}:9199`,
  firestoreEmulatorHost: LOCAL_HOST,
  firestoreEmulatorPort: 8180,
  functionsEmulatorHost: LOCAL_HOST,
  functionsEmulatorPort: 5501,
  functionsRegion: FUNCTION_REGION,
});

const PRODUCTION_FUNCTION_ROUTES = Object.freeze({
  "https://resolveloginlocation-hyhcwrnyaa-uc.a.run.app": "resolveLoginLocation",
  "https://us-central1-cyjsituation-analysis.cloudfunctions.net/checkDeviceAccess": "checkDeviceAccess",
  "https://us-central1-cyjsituation-analysis.cloudfunctions.net/getApplicationLoginDirectory": "getApplicationLoginDirectory",
  "https://us-central1-cyjsituation-analysis.cloudfunctions.net/changeApplicationPassword": "changeApplicationPassword",
  "https://us-central1-cyjsituation-analysis.cloudfunctions.net/manageApplicationAccount": "manageApplicationAccount",
  "https://us-central1-cyjsituation-analysis.cloudfunctions.net/manageManagerOrganization": "manageManagerOrganization",
  "https://us-central1-cyjsituation-analysis.cloudfunctions.net/manageManagementDelegation": "manageManagementDelegation",
  "https://us-central1-cyjsituation-analysis.cloudfunctions.net/manageTherapistMaster": "manageTherapistMaster",
  "https://us-central1-cyjsituation-analysis.cloudfunctions.net/reviewDeviceApproval": "reviewDeviceApproval",
  "https://us-central1-cyjsituation-analysis.cloudfunctions.net/manageAccountDevice": "manageAccountDevice",
  "https://us-central1-cyjsituation-analysis.cloudfunctions.net/emergencyUnblockDevice": "emergencyUnblockDevice",
  "https://us-central1-cyjsituation-analysis.cloudfunctions.net/reportLoginSecurityEvent": "reportLoginSecurityEvent",
  "https://us-central1-cyjsituation-analysis.cloudfunctions.net/updateTelegramSecurityAlertConfig": "updateTelegramSecurityAlertConfig",
  "https://us-central1-cyjsituation-analysis.cloudfunctions.net/manageSystemExclusions": "manageSystemExclusions",
  "https://us-central1-cyjsituation-analysis.cloudfunctions.net/manageStoreLifecycle": "manageStoreLifecycle",
  "https://us-central1-cyjsituation-analysis.cloudfunctions.net/manageModulePermissions": "manageModulePermissions",
  "https://us-central1-cyjsituation-analysis.cloudfunctions.net/manageAdministrativeSetting": "manageAdministrativeSetting",
  "https://us-central1-cyjsituation-analysis.cloudfunctions.net/manageProjectionContext": "manageProjectionContext",
  "https://us-central1-cyjsituation-analysis.cloudfunctions.net/getProductionHealthSnapshot": "getProductionHealthSnapshot",
  "https://us-central1-cyjsituation-analysis.cloudfunctions.net/manageActivitySalesPolicy": "manageActivitySalesPolicy",
  "https://us-central1-cyjsituation-analysis.cloudfunctions.net/manageActivityCampaign": "manageActivityCampaign",
});

const normalizeEndpointKey = (rawUrl = "") => {
  try {
    const url = new URL(String(rawUrl || ""));
    const pathname = url.pathname.replace(/\/+$/, "");
    return `${url.origin}${pathname}`;
  } catch {
    return "";
  }
};

export const resolveActivitySalesDevFunctionUrl = (rawUrl = "") => {
  const original = String(rawUrl || "");
  if (!ACTIVITY_SALES_DEV_MODE || !original) return original;

  const key = normalizeEndpointKey(original);
  const functionName = PRODUCTION_FUNCTION_ROUTES[key];
  if (functionName) {
    const url = new URL(original);
    const localBase =
      `http://${ACTIVITY_SALES_RUNTIME.functionsEmulatorHost}:` +
      `${ACTIVITY_SALES_RUNTIME.functionsEmulatorPort}/` +
      `${ACTIVITY_SALES_RUNTIME.projectId}/` +
      `${ACTIVITY_SALES_RUNTIME.functionsRegion}/${functionName}`;
    return `${localBase}${url.search}${url.hash}`;
  }

  try {
    const url = new URL(original);
    const isProductionCloudFunction =
      url.hostname === "us-central1-cyjsituation-analysis.cloudfunctions.net";
    const isCloudRunEndpoint = url.hostname.endsWith(".a.run.app");

    if (isProductionCloudFunction || isCloudRunEndpoint) {
      throw new Error(
        `Activity Sales DEV 阻止未登錄的 Production Function：${key || original}`
      );
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("Activity Sales DEV")) {
      throw error;
    }
  }

  return original;
};

const installFetchIsolation = () => {
  if (!ACTIVITY_SALES_DEV_MODE || typeof globalThis === "undefined") return;
  if (globalThis.__DRCYJ_ACTIVITY_SALES_FETCH_ISOLATED__) return;
  if (typeof globalThis.fetch !== "function") return;

  const originalFetch = globalThis.fetch.bind(globalThis);

  globalThis.fetch = (input, init) => {
    const rawUrl =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : typeof Request !== "undefined" && input instanceof Request
            ? input.url
            : "";

    const isolatedUrl = resolveActivitySalesDevFunctionUrl(rawUrl);
    if (!rawUrl || isolatedUrl === rawUrl) {
      return originalFetch(input, init);
    }

    if (typeof Request !== "undefined" && input instanceof Request) {
      return originalFetch(new Request(isolatedUrl, input), init);
    }

    return originalFetch(isolatedUrl, init);
  };

  globalThis.__DRCYJ_ACTIVITY_SALES_FETCH_ISOLATED__ = true;
};

const installDevBadge = () => {
  if (!ACTIVITY_SALES_DEV_MODE || typeof document === "undefined") return;

  const mount = () => {
    if (!document.body || document.getElementById("activity-sales-dev-badge")) return;

    const badge = document.createElement("div");
    badge.id = "activity-sales-dev-badge";
    badge.textContent = "ACTIVITY SALES DEV · LOCAL DEMO · 不連正式資料";
    badge.title = `Firebase project: ${ACTIVITY_SALES_RUNTIME.projectId}`;
    Object.assign(badge.style, {
      position: "fixed",
      right: "12px",
      bottom: "12px",
      zIndex: "2147483647",
      borderRadius: "999px",
      padding: "7px 11px",
      background: "#be6579",
      color: "#fff",
      fontSize: "10px",
      fontWeight: "800",
      letterSpacing: ".04em",
      boxShadow: "0 8px 24px rgba(80,40,48,.22)",
      pointerEvents: "none",
    });
    document.body.appendChild(badge);
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount, { once: true });
  } else {
    mount();
  }
};

installFetchIsolation();
installDevBadge();

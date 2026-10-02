export const RELEASE_IDENTITY_SCHEMA_VERSION = "release-identity-v1";

const normalizeText = (value = "", maxLength = 240) =>
  String(value ?? "").trim().slice(0, maxLength);

const normalizeVersion = (value = "") => {
  const version = normalizeText(value, 40);
  return /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version) ? version : "";
};

const normalizeCommit = (value = "") => {
  const commit = normalizeText(value, 40).toLowerCase();
  return /^[0-9a-f]{40}$/.test(commit) ? commit : "";
};

const normalizeAsset = (value = "") => {
  const asset = normalizeText(value, 240).replace(/^\/+/, "");
  return /^assets\/index-[A-Za-z0-9_-]+\.js$/.test(asset) ? asset : "";
};

export function normalizePublishedReleaseIdentity(value = {}) {
  if (!value || typeof value !== "object") {
    throw new Error("release_identity_invalid_payload");
  }

  const schemaVersion = normalizeText(value.schemaVersion, 80);
  if (schemaVersion !== RELEASE_IDENTITY_SCHEMA_VERSION) {
    throw new Error("release_identity_schema_mismatch");
  }

  const appVersion = normalizeVersion(value.appVersion);
  const sourceCommit = normalizeCommit(value.sourceCommit);
  const entryAsset = normalizeAsset(value.entryAsset);
  if (!appVersion || !sourceCommit || !entryAsset) {
    throw new Error("release_identity_incomplete");
  }

  return {
    schemaVersion,
    appVersion,
    sourceCommit,
    entryAsset,
  };
}

export function getLoadedEntryAsset(documentRef = typeof document !== "undefined" ? document : null) {
  if (!documentRef?.querySelectorAll) return "";

  const scripts = [...documentRef.querySelectorAll('script[src]')];
  for (const script of scripts) {
    const raw = normalizeText(script?.getAttribute?.("src") || script?.src || "", 500);
    const match = raw.match(/(?:^|\/)(assets\/index-[A-Za-z0-9_-]+\.js)(?:[?#].*)?$/);
    if (match?.[1]) return normalizeAsset(match[1]);
  }
  return "";
}

export function getServiceWorkerRuntimeState(
  navigatorRef = typeof navigator !== "undefined" ? navigator : null
) {
  const controller = navigatorRef?.serviceWorker?.controller || null;
  const scriptURL = normalizeText(controller?.scriptURL || "", 500);
  return {
    supported: Boolean(navigatorRef && "serviceWorker" in navigatorRef),
    controlled: Boolean(controller),
    scriptURL,
  };
}

export function buildReleaseIdentityStatus({
  appVersion = "",
  publishedSystemVersion = "",
  loadedEntryAsset = "",
  publishedRelease = null,
  serviceWorkerState = null,
} = {}) {
  const localVersion = normalizeVersion(appVersion);
  const systemVersion = normalizeVersion(publishedSystemVersion);
  const localAsset = normalizeAsset(loadedEntryAsset);
  const release = publishedRelease
    ? normalizePublishedReleaseIdentity(publishedRelease)
    : null;
  const sw = serviceWorkerState && typeof serviceWorkerState === "object"
    ? {
        supported: serviceWorkerState.supported === true,
        controlled: serviceWorkerState.controlled === true,
        scriptURL: normalizeText(serviceWorkerState.scriptURL || "", 500),
      }
    : { supported: false, controlled: false, scriptURL: "" };

  const mismatches = [];
  const unavailable = [];

  if (!release) unavailable.push("publishedRelease");
  if (!localVersion) unavailable.push("appVersion");
  if (!localAsset) unavailable.push("loadedEntryAsset");

  if (release && localVersion && release.appVersion !== localVersion) {
    mismatches.push("appVersion");
  }
  if (release && localAsset && release.entryAsset !== localAsset) {
    mismatches.push("entryAsset");
  }

  const systemVersionMismatch = Boolean(
    release && systemVersion && release.appVersion !== systemVersion
  );
  if (systemVersionMismatch) mismatches.push("systemVersion");

  let status = "healthy";
  let label = "正式版本一致";
  let detail = "目前瀏覽器載入內容與正式發布資訊一致。";

  if (unavailable.length > 0) {
    status = "attention";
    label = "正式版本資訊待確認";
    detail = "部分發布資訊暫時無法取得，請重新檢查。";
  } else if (mismatches.includes("appVersion") || mismatches.includes("entryAsset")) {
    status = "stale";
    label = "目前瀏覽器不是最新發布內容";
    detail = "請重新整理或重新開啟系統，讓瀏覽器載入正式版本。";
  } else if (systemVersionMismatch) {
    status = "attention";
    label = "正式版本已發布，更新標記待同步";
    detail = "瀏覽器已載入正式發布內容，但 system_version 更新標記尚未一致。";
  }

  return {
    status,
    label,
    detail,
    appVersion: localVersion,
    publishedSystemVersion: systemVersion,
    loadedEntryAsset: localAsset,
    publishedRelease: release,
    serviceWorker: sw,
    mismatches: [...new Set(mismatches)],
    unavailable: [...new Set(unavailable)],
  };
}

export async function fetchPublishedReleaseIdentity({
  fetchImpl = typeof fetch === "function" ? fetch : null,
  baseUrl = typeof import.meta !== "undefined" ? (import.meta.env?.BASE_URL || "/") : "/",
  origin = typeof window !== "undefined" ? window.location.origin : "http://localhost",
  now = Date.now(),
} = {}) {
  if (typeof fetchImpl !== "function") {
    throw new Error("release_identity_fetch_unavailable");
  }

  const normalizedBase = `/${String(baseUrl || "/").replace(/^\/+|\/+$/g, "")}/`
    .replace(/^\/\/$/, "/");
  const releaseUrl = new URL(`${normalizedBase}release.json`, origin);
  releaseUrl.searchParams.set("release_health", String(now));

  const response = await fetchImpl(releaseUrl.toString(), {
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if (!response?.ok) {
    throw new Error(`release_identity_http_${Number(response?.status || 0)}`);
  }

  return normalizePublishedReleaseIdentity(await response.json());
}

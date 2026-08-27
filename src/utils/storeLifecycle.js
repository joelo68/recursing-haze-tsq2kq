export const STORE_LIFECYCLE_SCHEMA_VERSION = "store-lifecycle-v1";
export const STORE_LIFECYCLE_DATASET_STATUSES = Object.freeze(["BUILDING", "READY"]);

const BRAND_META = Object.freeze({
  cyj: { id: "cyj", label: "CYJ", prefix: "CYJ" },
  anniu: { id: "anniu", label: "安妞", prefix: "安妞" },
  yibo: { id: "yibo", label: "伊啵", prefix: "伊啵" },
});

export const normalizeLifecycleBrandId = (value = "") => {
  const raw = typeof value === "object" && value ? (value.id || value.brandId || value.value) : value;
  const id = String(raw || "cyj").trim().toLowerCase();
  if (["default", "default-app-id", "drcyj", "cyj"].includes(id)) return "cyj";
  if (["anniu", "anew", "安妞"].includes(id)) return "anniu";
  if (["yibo", "伊啵"].includes(id)) return "yibo";
  return "cyj";
};

export const getLifecycleBrandMeta = (brandId = "cyj") => (
  BRAND_META[normalizeLifecycleBrandId(brandId)] || BRAND_META.cyj
);

export const detectLifecycleStoreBrand = (value = "") => {
  const text = String(value || "").trim().replace(/[　\s]+/g, "");
  if (/^(DR\.?CYJ|CYJ)/i.test(text)) return "cyj";
  if (/^(Anew安妞|Anew|Ann|安妞)/i.test(text)) return "anniu";
  if (/^(Yibo伊啵|Yibo|伊啵)/i.test(text)) return "yibo";
  return "";
};

export const lifecycleStoreBrandMatches = (value = "", brandId = "cyj") => {
  const detected = detectLifecycleStoreBrand(value);
  return !detected || detected === normalizeLifecycleBrandId(brandId);
};

const stripBrandPrefix = (value = "") => String(value || "")
  .trim()
  .replace(/[　\s]+/g, "")
  .replace(/[（）()]/g, "")
  .replace(/臺/g, "台")
  .replace(/^DR\.?CYJ/i, "CYJ")
  .replace(/^(CYJ|Anew安妞|Yibo伊啵|Anew|Yibo|Ann|安妞|伊啵)/i, "")
  .trim();

export const normalizeStoreLifecycleCore = (value = "") => {
  const core = stripBrandPrefix(value);
  if (!core) return "";

  // Production Store Identity guard：歷史上「新店」曾被誤裁成「新」。
  // Lifecycle 必須把所有已知 alias 歸到同一個 core，避免建立第二套 store identity。
  if (core === "新" || /^新店店?$/.test(core)) return "新店";

  return core.replace(/店+$/g, "").trim();
};

export const getCanonicalLifecycleStoreName = (value = "", brandId = "cyj") => {
  const core = normalizeStoreLifecycleCore(value);
  if (!core) return "";
  const { prefix } = getLifecycleBrandMeta(brandId);
  return `${prefix}${core}店`;
};

export const getStoreLifecycleKey = (value = "") => normalizeStoreLifecycleCore(value);

export const normalizeYearMonth = (value = "") => {
  const text = String(value || "").trim();
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(text) ? text : "";
};

export const normalizeIsoDate = (value = "") => {
  const text = String(value || "").trim();
  if (!/^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/.test(text)) return "";
  const date = new Date(`${text}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "";
  const [year, month, day] = text.split("-").map(Number);
  if (date.getFullYear() !== year || date.getMonth() + 1 !== month || date.getDate() !== day) return "";
  return text;
};

export const normalizeExemptMonths = (values = []) => {
  const source = Array.isArray(values) ? values : [];
  return [...new Set(source.map(normalizeYearMonth).filter(Boolean))].sort();
};

export const getLifecycleEntryCompleteness = (entry = {}) => {
  const firstEligibleMonth = normalizeYearMonth(entry.firstEligibleMonth);
  const openDate = normalizeIsoDate(entry.openDate);
  const lastEligibleMonth = normalizeYearMonth(entry.lastEligibleMonth);
  const closeDate = normalizeIsoDate(entry.closeDate);

  if (!firstEligibleMonth || !openDate) return "INCOMPLETE";
  if (openDate.slice(0, 7) > firstEligibleMonth) return "INVALID";

  const hasClosureMonth = Boolean(lastEligibleMonth);
  const hasCloseDate = Boolean(closeDate);
  if (hasClosureMonth !== hasCloseDate) return "INCOMPLETE";

  if (hasClosureMonth) {
    if (lastEligibleMonth < firstEligibleMonth) return "INVALID";
    if (closeDate < openDate) return "INVALID";
    if (closeDate.slice(0, 7) !== lastEligibleMonth) return "INVALID";
  }

  const exemptMonths = normalizeExemptMonths(entry.exemptMonths);
  if (exemptMonths.some((month) => month < firstEligibleMonth)) return "INVALID";
  if (lastEligibleMonth && exemptMonths.some((month) => month > lastEligibleMonth)) return "INVALID";
  if (exemptMonths.includes(firstEligibleMonth)) return "INVALID";
  if (lastEligibleMonth && exemptMonths.includes(lastEligibleMonth)) return "INVALID";

  return "COMPLETE";
};

export const validateLifecycleEntryDraft = (entry = {}) => {
  const errors = [];
  const firstRaw = String(entry.firstEligibleMonth || "").trim();
  const openRaw = String(entry.openDate || "").trim();
  const lastRaw = String(entry.lastEligibleMonth || "").trim();
  const closeRaw = String(entry.closeDate || "").trim();

  const firstEligibleMonth = normalizeYearMonth(firstRaw);
  const openDate = normalizeIsoDate(openRaw);
  const lastEligibleMonth = normalizeYearMonth(lastRaw);
  const closeDate = normalizeIsoDate(closeRaw);
  const rawExemptMonths = entry.exemptMonths == null ? [] : entry.exemptMonths;
  const exemptMonths = normalizeExemptMonths(rawExemptMonths);

  if (!Array.isArray(rawExemptMonths)) errors.push("暫停營運月份格式必須是月份清單");
  else if (rawExemptMonths.some((month) => String(month || "").trim() && !normalizeYearMonth(month))) errors.push("暫停營運月份格式需為 YYYY-MM");
  if (firstRaw && !firstEligibleMonth) errors.push("納入月份格式需為 YYYY-MM");
  if (openRaw && !openDate) errors.push("開始日期格式需為 YYYY-MM-DD");
  if (lastRaw && !lastEligibleMonth) errors.push("永久結束月份格式需為 YYYY-MM");
  if (closeRaw && !closeDate) errors.push("永久結束日期格式需為 YYYY-MM-DD");

  if (firstEligibleMonth && openDate && openDate.slice(0, 7) > firstEligibleMonth) {
    errors.push("實際開始營運日期不可晚於首次正式納管月份");
  }

  if (lastEligibleMonth && closeDate && closeDate.slice(0, 7) !== lastEligibleMonth) {
    errors.push("永久結束日期必須落在永久結束月份內");
  }

  if (firstEligibleMonth && lastEligibleMonth && lastEligibleMonth < firstEligibleMonth) {
    errors.push("永久結束月份不可早於納入月份");
  }

  if (openDate && closeDate && closeDate < openDate) {
    errors.push("永久結束日期不可早於開始日期");
  }

  if (exemptMonths.length && !firstEligibleMonth) {
    errors.push("設定暫停營運月份前，請先設定納入月份");
  }

  if (firstEligibleMonth && exemptMonths.some((month) => month < firstEligibleMonth)) {
    errors.push("暫停營運月份不可早於納入月份");
  }

  if (lastEligibleMonth && exemptMonths.some((month) => month > lastEligibleMonth)) {
    errors.push("暫停營運月份不可晚於永久結束月份");
  }

  if (firstEligibleMonth && exemptMonths.includes(firstEligibleMonth)) {
    errors.push("開店／納入月份必須是正式納管月份，不可同時設為整月暫停");
  }

  if (lastEligibleMonth && exemptMonths.includes(lastEligibleMonth)) {
    errors.push("永久結束月份仍是正式納管月份，不可同時設為整月暫停");
  }

  return {
    valid: errors.length === 0,
    errors,
    normalized: {
      firstEligibleMonth,
      openDate,
      lastEligibleMonth,
      closeDate,
      exemptMonths,
    },
  };
};

export const normalizeLifecycleEntry = (raw = {}, fallbackStoreName = "", brandId = "cyj") => {
  const canonicalStoreName = getCanonicalLifecycleStoreName(
    raw.canonicalStoreName || raw.storeName || fallbackStoreName,
    brandId
  );
  const coreStoreName = normalizeStoreLifecycleCore(
    raw.coreStoreName || raw.storeKey || canonicalStoreName || fallbackStoreName
  );

  const normalized = {
    ...raw,
    storeKey: coreStoreName,
    coreStoreName,
    canonicalStoreName,
    firstEligibleMonth: normalizeYearMonth(raw.firstEligibleMonth),
    lastEligibleMonth: normalizeYearMonth(raw.lastEligibleMonth),
    openDate: normalizeIsoDate(raw.openDate),
    closeDate: normalizeIsoDate(raw.closeDate),
    exemptMonths: normalizeExemptMonths(raw.exemptMonths),
    revision: Math.max(0, Number(raw.revision || 0)),
  };

  return {
    ...normalized,
    // entryStatus 是衍生狀態，不把舊版持久化狀態當權威。
    // 當 Lifecycle business rule 升級時，載入後應依目前欄位重新計算，避免舊 INVALID/COMPLETE 卡住 UI。
    entryStatus: getLifecycleEntryCompleteness(normalized),
  };
};

export const normalizeLifecycleMaster = (raw = {}, brandId = "cyj") => {
  const normalizedBrandId = normalizeLifecycleBrandId(brandId || raw.brandId);
  const rawStores = raw?.stores && typeof raw.stores === "object" && !Array.isArray(raw.stores)
    ? raw.stores
    : {};
  const stores = {};

  Object.entries(rawStores).forEach(([key, value]) => {
    const entry = normalizeLifecycleEntry(value || {}, key, normalizedBrandId);
    if (entry.storeKey) stores[entry.storeKey] = entry;
  });

  return {
    schemaVersion: String(raw.schemaVersion || STORE_LIFECYCLE_SCHEMA_VERSION),
    brandId: normalizedBrandId,
    datasetStatus: STORE_LIFECYCLE_DATASET_STATUSES.includes(String(raw.datasetStatus || ""))
      ? String(raw.datasetStatus)
      : "BUILDING",
    revision: Math.max(0, Number(raw.revision || 0)),
    stores,
    certifiedAtText: String(raw.certifiedAtText || ""),
    certifiedBy: String(raw.certifiedBy || ""),
    updatedAtText: String(raw.updatedAtText || ""),
    updatedBy: String(raw.updatedBy || ""),
  };
};

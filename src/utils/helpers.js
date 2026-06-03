// src/utils/helpers.js

export const generateUUID = () => {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    try {
      return crypto.randomUUID();
    } catch (e) {
      // Fallback
    }
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
    var r = (Math.random() * 16) | 0,
      v = c == "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};

export const formatLocalYYYYMMDD = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export const toStandardDateFormat = (dateStr) => {
  if (!dateStr) return "";
  const date = new Date(dateStr.replace(/-/g, "/"));
  if (isNaN(date.getTime())) return dateStr;
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}/${m}/${d}`;
};

export const formatNumber = (val) => {
  if (!val) return "";
  const num = val.toString().replace(/,/g, "");
  if (isNaN(num)) return val;
  return Number(num).toLocaleString();
};

export const parseNumber = (val) => {
  if (!val) return 0;
  return Number(val.toString().replace(/,/g, ""));
};

// ============================================================================
// 下拉選單共用排序工具
// 只處理前端已載入資料，不觸發 Firestore reads。
// v3：優先使用 org_structure.managerOrder 作為穩定區長順序。
// ============================================================================

export const normalizeStoreCoreName = (name = "") => {
  if (!name) return "";
  return String(name)
    .replace(/^(DRCYJ|DR\.CYJ|CYJ|Anew\s*\(安妞\)|Yibo\s*\(伊啵\)|安妞|伊啵|Anew|Yibo|Ann)\s*/i, "")
    .replace(/店$/i, "")
    .replace(/[　\s]+/g, "")
    .trim();
};

export const normalizeOptionText = (value = "") => {
  return String(value || "").replace(/[　\s]+/g, "").trim();
};

export const zhCompare = (a = "", b = "") => {
  return String(a || "").localeCompare(String(b || ""), "zh-Hant", {
    numeric: true,
    sensitivity: "base",
  });
};

const isFirstOption = (value = "") => {
  const text = normalizeOptionText(value).toLowerCase();
  return text === "all" || text === "全部" || text === "全品牌" || text === "顯示全區" || text === "全部店家" || text === "全區店家";
};

const isLastOption = (value = "") => {
  const text = normalizeOptionText(value);
  return (
    text.includes("未分配") ||
    text.includes("未分區") ||
    text.includes("其他") ||
    text.includes("離職") ||
    text.includes("封存") ||
    text.includes("停用")
  );
};

export const sortNamesZhTW = (items = [], getLabel = (item) => item) => {
  return [...(items || [])].sort((a, b) => {
    const aText = getLabel(a);
    const bText = getLabel(b);

    if (isFirstOption(aText) && !isFirstOption(bText)) return -1;
    if (!isFirstOption(aText) && isFirstOption(bText)) return 1;
    if (isLastOption(aText) && !isLastOption(bText)) return 1;
    if (!isLastOption(aText) && isLastOption(bText)) return -1;

    return zhCompare(aText, bText);
  });
};

// 舊函式保留：未提供 managerOrder 時作為 fallback。
export const sortManagerNames = (managers = []) => {
  return sortNamesZhTW(managers, (name) => String(name || "").replace(/區$/g, ""));
};

export const sortStoreNames = (stores = []) => {
  return sortNamesZhTW(stores, (name) => normalizeStoreCoreName(name));
};

export const normalizeManagerOrder = (managers = {}, managerOrder = []) => {
  const managerKeys = Object.keys(managers || {});
  const orderSource = Array.isArray(managerOrder) && managerOrder.length > 0
    ? managerOrder
    : sortNamesZhTW(managerKeys);

  const seen = new Set();
  const normal = [];
  const ending = [];

  orderSource.forEach((name) => {
    const key = String(name || "").trim();
    if (!key || seen.has(key) || !managerKeys.includes(key)) return;
    seen.add(key);
    if (isLastOption(key)) ending.push(key);
    else normal.push(key);
  });

  // 新增但尚未寫入 managerOrder 的區長，接在正常區長後方，避免消失。
  sortNamesZhTW(managerKeys.filter((name) => !seen.has(name))).forEach((name) => {
    if (isLastOption(name)) ending.push(name);
    else normal.push(name);
  });

  return [...normal, ...ending];
};

export const sortManagersByOrgOrder = (managers = {}, managerList = null, managerOrder = []) => {
  const order = normalizeManagerOrder(managers, managerOrder);
  const source = managerList || order;
  const rank = new Map(order.map((name, index) => [String(name), index]));

  return [...(source || [])].sort((a, b) => {
    if (isFirstOption(a) && !isFirstOption(b)) return -1;
    if (!isFirstOption(a) && isFirstOption(b)) return 1;
    if (isLastOption(a) && !isLastOption(b)) return 1;
    if (!isLastOption(a) && isLastOption(b)) return -1;

    const ar = rank.has(String(a)) ? rank.get(String(a)) : 9999;
    const br = rank.has(String(b)) ? rank.get(String(b)) : 9999;
    if (ar !== br) return ar - br;

    return zhCompare(a, b);
  });
};

export const buildStoreOrderIndex = (managers = {}, brandPrefix = "", managerOrder = []) => {
  const index = new Map();
  let cursor = 0;

  sortManagersByOrgOrder(managers, null, managerOrder).forEach((managerName) => {
    const stores = managers?.[managerName] || [];
    stores.forEach((storeName) => {
      const core = normalizeStoreCoreName(storeName);
      if (!core) return;

      const variants = [
        core,
        `${core}店`,
        brandPrefix ? `${brandPrefix}${core}` : "",
        brandPrefix ? `${brandPrefix}${core}店` : "",
        `CYJ${core}`,
        `CYJ${core}店`,
        `安妞${core}`,
        `安妞${core}店`,
        `伊啵${core}`,
        `伊啵${core}店`,
      ].filter(Boolean);

      variants.forEach((v) => {
        const key = normalizeStoreCoreName(v);
        if (key && !index.has(key)) index.set(key, cursor);
      });
      cursor += 1;
    });
  });

  return index;
};

export const sortStoresByOrgOrder = (managers = {}, stores = [], brandPrefix = "", managerOrder = []) => {
  const index = buildStoreOrderIndex(managers, brandPrefix, managerOrder);

  return [...(stores || [])].sort((a, b) => {
    if (isFirstOption(a) && !isFirstOption(b)) return -1;
    if (!isFirstOption(a) && isFirstOption(b)) return 1;
    if (isLastOption(a) && !isLastOption(b)) return 1;
    if (!isLastOption(a) && isLastOption(b)) return -1;

    const aCore = normalizeStoreCoreName(a);
    const bCore = normalizeStoreCoreName(b);
    const ar = index.has(aCore) ? index.get(aCore) : 9999;
    const br = index.has(bCore) ? index.get(bCore) : 9999;

    if (ar !== br) return ar - br;
    return zhCompare(aCore, bCore);
  });
};

export const buildGroupedStoreOptions = (managers = {}, stores = [], brandPrefix = "", managerOrder = []) => {
  const available = new Set((stores || []).map((s) => normalizeStoreCoreName(s)).filter(Boolean));
  const used = new Set();
  const groups = {};

  sortManagersByOrgOrder(managers, null, managerOrder).forEach((managerName) => {
    const groupStores = [];
    (managers?.[managerName] || []).forEach((rawStore) => {
      const core = normalizeStoreCoreName(rawStore);
      if (!core || !available.has(core)) return;
      const matched = (stores || []).find((s) => normalizeStoreCoreName(s) === core) || `${brandPrefix}${core}店`;
      if (!groupStores.includes(matched)) groupStores.push(matched);
      used.add(core);
    });
    if (groupStores.length > 0) {
      groups[managerName] = sortStoresByOrgOrder(managers, groupStores, brandPrefix, managerOrder);
    }
  });

  const orphans = (stores || []).filter((s) => !used.has(normalizeStoreCoreName(s)));
  if (orphans.length > 0) {
    groups["其他"] = sortStoreNames(orphans);
  }

  return groups;
};

export const sortStoreGroupsByManager = (groups = {}, managers = {}, brandPrefix = "", managerOrder = []) => {
  const sortedGroups = {};
  sortManagersByOrgOrder(managers, Object.keys(groups || {}), managerOrder).forEach((managerName) => {
    sortedGroups[managerName] = sortStoresByOrgOrder(managers, groups[managerName] || [], brandPrefix, managerOrder);
  });
  return sortedGroups;
};

export const sortTherapistsByStoreThenName = (therapists = [], managers = {}, brandPrefix = "", managerOrder = []) => {
  const storeIndex = buildStoreOrderIndex(managers, brandPrefix, managerOrder);

  return [...(therapists || [])].sort((a, b) => {
    const storeA = normalizeStoreCoreName(a?.storeName || a?.store || "");
    const storeB = normalizeStoreCoreName(b?.storeName || b?.store || "");
    const ar = storeIndex.has(storeA) ? storeIndex.get(storeA) : 9999;
    const br = storeIndex.has(storeB) ? storeIndex.get(storeB) : 9999;

    if (ar !== br) return ar - br;

    const storeCompare = zhCompare(storeA, storeB);
    if (storeCompare !== 0) return storeCompare;

    return zhCompare(a?.name || a?.therapistName || a?.displayName || a?.id || "", b?.name || b?.therapistName || b?.displayName || b?.id || "");
  });
};

export const uniqueSortedStoreNames = (stores = [], managers = {}, brandPrefix = "", managerOrder = []) => {
  return sortStoresByOrgOrder(managers, [...new Set((stores || []).filter(Boolean))], brandPrefix, managerOrder);
};

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
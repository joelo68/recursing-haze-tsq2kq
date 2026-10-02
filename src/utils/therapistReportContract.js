// src/utils/therapistReportContract.js
// Anniu therapist daily-report additive revenue contract.
// Pure module: no Firestore reads, writes, listeners, queries, or polling.

export const ANNIU_THERAPIST_SKINCARE_FIELDS = Object.freeze([
  "newCustomerSkincareRevenue",
  "oldCustomerSkincareRevenue",
]);

const BASE_THERAPIST_REPORT_WRITABLE_FIELDS = Object.freeze([
  "totalRevenue",
  "newCustomerRevenue",
  "newCustomerCount",
  "newCustomerClosings",
  "oldCustomerRevenue",
  "oldCustomerCount",
  "returnRevenue",
]);

const normalizeBrandId = (brand) => {
  const raw = typeof brand === "string"
    ? brand
    : (brand?.id || brand?.brandId || brand?.name || brand?.label || "");
  return String(raw || "").trim().toLowerCase();
};

const toRevenueNumber = (value) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const normalized = String(value ?? "").replace(/,/g, "").trim();
  if (!normalized) return 0;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : 0;
};

export const isAnniuTherapistReportBrand = (brand) => {
  const id = normalizeBrandId(brand);
  return id === "anniu" || id === "anew" || id.includes("anniu") || id.includes("anew") || id.includes("安妞");
};

export const calculateTherapistReportTotalRevenue = (row = {}, brand = "") => {
  const baseTotal =
    toRevenueNumber(row.newCustomerRevenue) +
    toRevenueNumber(row.oldCustomerRevenue) -
    toRevenueNumber(row.returnRevenue);

  if (!isAnniuTherapistReportBrand(brand)) return baseTotal;

  return baseTotal +
    toRevenueNumber(row.newCustomerSkincareRevenue) +
    toRevenueNumber(row.oldCustomerSkincareRevenue);
};

export const getTherapistReportWritableFields = (brand = "") => {
  if (!isAnniuTherapistReportBrand(brand)) {
    return [...BASE_THERAPIST_REPORT_WRITABLE_FIELDS];
  }

  return [
    "totalRevenue",
    "newCustomerRevenue",
    "newCustomerSkincareRevenue",
    "newCustomerCount",
    "newCustomerClosings",
    "oldCustomerRevenue",
    "oldCustomerSkincareRevenue",
    "oldCustomerCount",
    "returnRevenue",
  ];
};

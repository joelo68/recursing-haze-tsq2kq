// Phase 1B published-only consumer contracts. Private authority collections stay Backend-only.
const BRAND_IDS = new Set(["cyj", "anniu", "yibo"]);

export const getActivitySalesPublicationPath = (brandId) => {
  if (!BRAND_IDS.has(brandId)) throw new Error("ACTIVITY_SALES_BRAND_INVALID");
  return brandId === "cyj"
    ? "artifacts/default-app-id/public/data/activity_sales_publications"
    : `brands/${brandId}/activity_sales_publications`;
};

export const taipeiDateString = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const find = (name) => parts.find((p) => p.type === name)?.value || "";
  return `${find("year")}-${find("month")}-${find("day")}`;
};

export const listPublishedCampaigns = (docs = [], today = taipeiDateString()) =>
  docs.filter((doc) => doc?.status === "published"
      && typeof doc.title === "string"
      && typeof doc.startDate === "string" && doc.startDate.length === 10
      && typeof doc.endDate === "string" && doc.endDate >= today
      && Array.isArray(doc.packages) && doc.packages.length > 0);

export const searchPublishedCampaigns = (docs = [], search = "") => {
  const keyword = String(search).trim().toLocaleLowerCase("zh-TW");
  if (!keyword) return docs;
  return docs.filter((campaign) => [campaign.title, campaign.shortSummary,
    ...(campaign.tags || []), ...(campaign.sellingPoints || []),
    ...(campaign.packages || []).map((item) => item.name)]
    .some((value) => String(value || "").toLocaleLowerCase("zh-TW").includes(keyword)));
};

export const calculateActivityPackage = (pkg, quantity) => {
  const qty = Number(quantity);
  if (!Number.isSafeInteger(qty) || qty < 1 || qty > 99) throw new Error("QUANTITY_INVALID");
  if (!pkg || !Number.isSafeInteger(pkg.salePrice) || pkg.salePrice < 0 || !Array.isArray(pkg.items)) {
    throw new Error("PACKAGE_INVALID");
  }
  const lines = pkg.items.map((item) => {
    if (!Number.isSafeInteger(item.attributedAmount) || item.attributedAmount < 0) throw new Error("ATTRIBUTION_INVALID");
    return { ...item, totalAttributedAmount: item.attributedAmount * qty };
  });
  const total = pkg.salePrice * qty;
  const attributionTotal = lines.reduce((sum, item) => sum + item.totalAttributedAmount, 0);
  if (attributionTotal !== total) throw new Error("ATTRIBUTION_MISMATCH");
  return { quantity: qty, total, attributionTotal, lines };
};

import test from "node:test";
import assert from "node:assert/strict";
import { getActivitySalesPublicationPath, taipeiDateString, listPublishedCampaigns, searchPublishedCampaigns, calculateActivityPackage } from "../src/utils/activitySalesPublished.js";
const pkg = { packageId: "p", name: "顧客組", salePrice: 9800, items: [
  { itemId: "course", name: "課程", quantity: 2, attributedAmount: 7000 },
  { itemId: "product", name: "商品", quantity: 1, attributedAmount: 2800 },
] };
const pub = { campaignId: "fall", title: "秋季育髮", shortSummary: "新客", tags: ["秋天"],
  startDate: "2026-10-01", endDate: "2026-10-31", status: "published", packages: [pkg] };
test("brand isolation maps all three brands to canonical Firestore paths", () => {
  assert.equal(getActivitySalesPublicationPath("cyj"), "artifacts/default-app-id/public/data/activity_sales_publications");
  assert.equal(getActivitySalesPublicationPath("anniu"), "brands/anniu/activity_sales_publications");
  assert.equal(getActivitySalesPublicationPath("yibo"), "brands/yibo/activity_sales_publications");
  assert.throws(() => getActivitySalesPublicationPath("default-app-id"), /BRAND_INVALID/);
  assert.throws(() => getActivitySalesPublicationPath("unknown"), /BRAND_INVALID/);
});
test("only published, unexpired, complete activity cards are selected", () => {
  assert.deepEqual(listPublishedCampaigns([pub, { ...pub, status: "draft" }, { ...pub, endDate: "2026-09-30" }, { ...pub, packages: [] }], "2026-10-08"), [pub]);
});
test("search finds official title, tag and bundle name", () => {
  assert.equal(searchPublishedCampaigns([pub], "育髮").length, 1);
  assert.equal(searchPublishedCampaigns([pub], "秋天").length, 1);
  assert.equal(searchPublishedCampaigns([pub], "顧客組").length, 1);
  assert.equal(searchPublishedCampaigns([pub], "不存在").length, 0);
});
test("calculator attributes exactly the official price with no second revenue", () => {
  const result = calculateActivityPackage(pkg, 3);
  assert.equal(result.total, 29400);
  assert.equal(result.attributionTotal, 29400);
  assert.equal(result.lines[0].totalAttributedAmount, 21000);
  assert.equal(result.lines[1].totalAttributedAmount, 8400);
  assert.throws(() => calculateActivityPackage({ ...pkg, salePrice: 9801 }, 1), /ATTRIBUTION_MISMATCH/);
  assert.throws(() => calculateActivityPackage(pkg, 0), /QUANTITY_INVALID/);
  assert.throws(() => calculateActivityPackage(pkg, 100), /QUANTITY_INVALID/);
  assert.throws(() => calculateActivityPackage(pkg, 1.5), /QUANTITY_INVALID/);
});
test("local calendar day uses Asia/Taipei not UTC boundary", () => {
  assert.equal(taipeiDateString(new Date("2026-10-07T17:30:00.000Z")), "2026-10-08");
});

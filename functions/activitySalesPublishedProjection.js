"use strict";

// Phase 1B: Backend-only published projection. Never copy approval policy,
// private reviewers, drafts, or audit records onto this frontline read surface.
const PROJECTION_SCHEMA_VERSION = "activity-sales-publication-v1";
const validBrands = new Set(["cyj", "anniu", "yibo"]);

function buildActivitySalesPublication({ brandId, campaignId, versionId, campaignSnapshot, publishedAtText }) {
  if (!validBrands.has(brandId) || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(campaignId || "") ||
      !/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(versionId || "")) {
    throw new Error("PUBLICATION_ID_INVALID");
  }
  const source = campaignSnapshot;
  if (!source || typeof source !== "object" || !source.title || !source.startDate || !source.endDate ||
      !Array.isArray(source.packages) || !source.packages.length) {
    throw new Error("PUBLICATION_SNAPSHOT_INVALID");
  }
  // Deliberate allow-list; no `...source` on public read model.
  const fields = ["title", "shortSummary", "startDate", "endDate", "storeScope", "stores",
    "customerTypes", "tags", "sellingPoints", "suitableFor", "notSuitableFor",
    "discountRules", "restrictions", "salesTalk", "faq", "packages"];
  const publication = {
    schemaVersion: PROJECTION_SCHEMA_VERSION,
    brandId, campaignId, versionId,
    status: "published",
    publishedAtText,
  };
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(source, field)) {
      publication[field] = source[field];
    }
  }
  return publication;
}

module.exports = { buildActivitySalesPublication, PROJECTION_SCHEMA_VERSION };

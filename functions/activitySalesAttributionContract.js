"use strict";
// Phase 2A-0: pure contract only. No Firestore reads/writes, no revenue aggregation.
// Persistent writers, authorized report ownership, corrections, refunds and reviews
// must be introduced in separately validated Phase 2 subbatches.
const crypto = require("node:crypto");
const STATES = Object.freeze({
  UNCONFIRMED: "UNCONFIRMED",
  CONFIRMED_ZERO: "CONFIRMED_ZERO",
  HAS_SALES: "HAS_SALES",
});
const BRANDS = new Set(["cyj", "anniu", "yibo"]);
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;

function assertDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("ACTIVITY_DATE_INVALID");
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== value) throw new Error("ACTIVITY_DATE_INVALID");
  return value;
}
function assertFiniteMoney(value) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > 100000000) {
    throw new Error("ACTIVITY_AMOUNT_INVALID");
  }
  return value;
}
function validIdentity(input) {
  if (!input || !BRANDS.has(input.brandId) || !SAFE_ID.test(input.campaignId || "") ||
    !SAFE_ID.test(input.versionId || "") || !input.versionId.startsWith(`${input.campaignId}_v`) ||
    !SAFE_ID.test(input.roleId || "") || typeof input.accountId !== "string" ||
    !input.accountId.trim() || input.accountId !== input.accountId.trim() || input.accountId.length > 160 ||
    /[\u0000-\u001f\u007f]/.test(input.accountId) ||
    !["therapist", "store"].includes(input.roleId)) throw new Error("ACTIVITY_ATTRIBUTION_IDENTITY_INVALID");
  return {
    brandId: input.brandId, campaignId: input.campaignId, versionId: input.versionId,
    roleId: input.roleId, accountId: input.accountId, reportDate: assertDate(input.reportDate),
  };
}
function attributionDocumentId(identity, saleId) {
  const fields = validIdentity(identity);
  if (!SAFE_ID.test(saleId || "")) throw new Error("ACTIVITY_SALE_ID_INVALID");
  // Stable opaque ID for future event source; never use raw account IDs as document paths.
  const digest = crypto.createHash("sha256").update([
    fields.brandId, fields.roleId, fields.accountId, fields.reportDate,
    fields.campaignId, fields.versionId, saleId,
  ].join("\0")).digest("hex");
  return `sale_${digest.slice(0,48)}`;
}
function normalizeAttributionSale(input = {}) {
  const identity = validIdentity(input);
  if (!SAFE_ID.test(input.saleId || "") || !SAFE_ID.test(input.packageId || "")) {
    throw new Error("ACTIVITY_SALE_ITEM_INVALID");
  }
  if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > 100) {
    throw new Error("ACTIVITY_SALE_QUANTITY_INVALID");
  }
  const amount = assertFiniteMoney(input.attributedAmount);
  if (amount <= 0) throw new Error("ACTIVITY_SALE_AMOUNT_ZERO");
  if (input.formalRevenueDelta !== undefined && input.formalRevenueDelta !== 0) {
    throw new Error("ACTIVITY_FORMAL_REVENUE_NON_ADDITIVE");
  }
  return {
    schemaVersion: "activity-sales-attribution-contract-v1",
    ...identity,
    saleId: input.saleId, packageId: input.packageId,
    quantity: input.quantity, attributedAmount: amount,
    formalRevenueDelta: 0, // invariant: NEVER add this to daily_reports / therapist_daily_reports
  };
}
function resolveDailyActivityState(confirmation, saleRecords = []) {
  if (!Array.isArray(saleRecords)) throw new Error("ACTIVITY_SALES_INVALID");
  // No confirmation document is semantically NOT zero, even when no sales exist.
  if (confirmation == null) {
    if (saleRecords.length !== 0) throw new Error("ACTIVITY_SALES_UNCONFIRMED_CONFLICT");
    return { status: STATES.UNCONFIRMED, attributedAmount: null, saleCount: null, formalRevenueDelta: 0 };
  }
  const status = confirmation.status;
  if (![STATES.HAS_SALES, STATES.CONFIRMED_ZERO].includes(status)) throw new Error("ACTIVITY_CONFIRMATION_INVALID");
  if (status === STATES.CONFIRMED_ZERO) {
    if (saleRecords.length) throw new Error("ACTIVITY_ZERO_HAS_SALES_CONFLICT");
    return { status, attributedAmount: 0, saleCount: 0, formalRevenueDelta: 0 };
  }
  if (!saleRecords.length) throw new Error("ACTIVITY_HAS_SALES_EMPTY");
  let total = 0;
  for (const sale of saleRecords) {
    if (!sale || sale.formalRevenueDelta !== 0) throw new Error("ACTIVITY_FORMAL_REVENUE_NON_ADDITIVE");
    total += assertFiniteMoney(sale.attributedAmount);
    if (!Number.isSafeInteger(total) || total > 1000000000) throw new Error("ACTIVITY_AMOUNT_OVERFLOW");
  }
  return { status, attributedAmount: total, saleCount: saleRecords.length, formalRevenueDelta: 0 };
}
function assertPublishedVersionForSale(sale, immutableVersion) {
  const identity = validIdentity(sale);
  if (!immutableVersion || immutableVersion.brandId !== identity.brandId ||
    immutableVersion.campaignId !== identity.campaignId || immutableVersion.versionId !== identity.versionId) {
    throw new Error("ACTIVITY_VERSION_BINDING_MISMATCH");
  }
  // Historical sales use the immutable executed version; they must NOT be rebound
  // to the current publication after an amendment.
  return true;
}
module.exports = {
  STATES, assertDate, validIdentity, attributionDocumentId,
  normalizeAttributionSale, resolveDailyActivityState, assertPublishedVersionForSale,
};

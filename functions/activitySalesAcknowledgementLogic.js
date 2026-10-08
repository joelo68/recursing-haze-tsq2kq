"use strict";
const crypto = require("crypto");

const BRANDS = new Set(["cyj","anniu","yibo"]);
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;

function normalizeAcknowledgementIdentity(raw = {}) {
  const brandId = String(raw.brandId || "");
  const campaignId = String(raw.campaignId || "");
  const versionId = String(raw.versionId || "");
  const roleId = String(raw.roleId || "");
  const accountId = String(raw.accountId || "").trim();
  if (!BRANDS.has(brandId) || !SAFE_ID.test(campaignId) ||
      !SAFE_ID.test(versionId) || !versionId.startsWith(`${campaignId}_v`) ||
      !SAFE_ID.test(roleId) || !accountId || accountId.length > 160) {
    throw new Error("ACK_IDENTITY_INVALID");
  }
  return {brandId,campaignId,versionId,roleId,accountId};
}

function acknowledgementDocumentId(identity) {
  const fields = normalizeAcknowledgementIdentity(identity);
  const hash = crypto.createHash("sha256").update(
    [fields.brandId,fields.campaignId,fields.versionId,fields.roleId,fields.accountId].join("\0")
  ).digest("hex");
  return `ack_${hash.slice(0,48)}`;
}

function isCurrentPublication(publication, identity) {
  return publication?.status === "published" &&
    publication?.brandId === identity.brandId &&
    publication?.campaignId === identity.campaignId &&
    publication?.versionId === identity.versionId;
}

module.exports = {normalizeAcknowledgementIdentity,acknowledgementDocumentId,isCurrentPublication};

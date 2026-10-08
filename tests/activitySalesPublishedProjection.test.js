import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { buildActivitySalesPublication, PROJECTION_SCHEMA_VERSION } = require("../functions/activitySalesPublishedProjection.js");
const snapshot = {
  title: "十月正式活動", shortSummary: "內部教育", startDate: "2026-10-01", endDate: "2026-10-31",
  storeScope: "all", tags: ["秋季"], sellingPoints: ["正式活動"],
  packages: [{ packageId: "p1", name: "A 組", salePrice: 8800,
    items: [{ itemId: "course", name: "課程", quantity: 1, attributedAmount: 7000 },
      { itemId: "product", name: "商品", quantity: 1, attributedAmount: 1800 }] }],
  approvalPlan: { mode: "all", selectors: [{ type: "account", roleId: "director", accountId: "secret" }] },
  creatorPrivateKey: "should-not-leak", credentialPassword: "never",
};
test("published projection exposes only allow-listed frontline information", () => {
  const doc = buildActivitySalesPublication({ brandId: "cyj", campaignId: "fall", versionId: "fall_v001", campaignSnapshot: snapshot, publishedAtText: "2026-10-08T00:00:00.000Z" });
  assert.equal(doc.schemaVersion, PROJECTION_SCHEMA_VERSION);
  assert.equal(doc.brandId, "cyj");
  assert.equal(doc.versionId, "fall_v001");
  assert.deepEqual(doc.packages, snapshot.packages);
  assert.equal(doc.approvalPlan, undefined);
  assert.equal(doc.credentialPassword, undefined);
  assert.equal(doc.creatorPrivateKey, undefined);
  assert.equal(doc.status, "published");
});
test("projection fails closed for unsupported brand, id and incomplete immutable snapshot", () => {
  assert.throws(() => buildActivitySalesPublication({ brandId: "other", campaignId: "fall", versionId: "fall_v001", campaignSnapshot: snapshot }), /PUBLICATION_ID_INVALID/);
  assert.throws(() => buildActivitySalesPublication({ brandId: "anniu", campaignId: "bad/path", versionId: "fall_v001", campaignSnapshot: snapshot }), /PUBLICATION_ID_INVALID/);
  assert.throws(() => buildActivitySalesPublication({ brandId: "yibo", campaignId: "fall", versionId: "fall_v001", campaignSnapshot: {} }), /PUBLICATION_SNAPSHOT_INVALID/);
});
test("backend publication operations stay in the campaign OCC transaction", () => {
  const code = fs.readFileSync(new URL("../functions/activitySalesAuthority.js", import.meta.url), "utf-8");
  assert.match(code, /tx\.set\(publishedRef\(brand,id\),buildActivitySalesPublication/);
  assert.match(code, /tx\.delete\(publishedRef\(brand,id\)\)/);
  assert.match(code, /tx\.get\(versionRef\(brand,current\.currentVersionId\)\)/);
  assert.doesNotMatch(code, /getBrandCollection\(db,[^)]*,"activity_sales_publications"\)\.add/);
});
test("private authority collections never appear in publication data", () => {
  const doc = buildActivitySalesPublication({ brandId: "anniu", campaignId: "fall", versionId: "fall_v002", campaignSnapshot: snapshot });
  for (const denied of ["approvalPlan", "createdBy", "createdAt", "reviewers", "decisions", "policyRevision"]) {
    assert.equal(Object.hasOwn(doc, denied), false);
  }
});

test("backend rejects cross-brand, cross-account or non-application token even with an actor credential", () => {
  const { assertActivitySalesSessionActor } = require("../functions/activitySalesSessionBoundary.js");
  const session = { ok: true, decoded: {
    drcyjIdentity: true, identityVersion: "application-identity-v1",
    brandId: "cyj", roleId: "director", accountId: "adminA",
  } };
  const actor = { roleId: "director", accountId: "adminA" };
  assert.equal(assertActivitySalesSessionActor(session,"cyj",actor),true);
  assert.throws(() => assertActivitySalesSessionActor(session,"anniu",actor), /登入品牌或帳號不一致/);
  assert.throws(() => assertActivitySalesSessionActor(session,"cyj",{roleId:"director",accountId:"adminB"}), /登入品牌或帳號不一致/);
  assert.throws(() => assertActivitySalesSessionActor({ok:true,decoded:{...session.decoded,drcyjIdentity:false}},"cyj",actor), /登入品牌或帳號不一致/);
});

import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const contract = require("../functions/activitySalesAttributionContract.js");
const sample = {brandId:"cyj",campaignId:"campaign_01",versionId:"campaign_01_v001",
  roleId:"therapist",accountId:"T001",reportDate:"2026-10-08",saleId:"S001",
  packageId:"pkg_01",quantity:1,attributedAmount:9800};

test("no report is UNCONFIRMED rather than zero", () => {
  assert.deepEqual(contract.resolveDailyActivityState(null),{
    status:"UNCONFIRMED",attributedAmount:null,saleCount:null,formalRevenueDelta:0,
  });
});
test("explicit zero is a separate affirmative fact", () => {
  assert.deepEqual(contract.resolveDailyActivityState({status:"CONFIRMED_ZERO"}),{
    status:"CONFIRMED_ZERO",attributedAmount:0,saleCount:0,formalRevenueDelta:0,
  });
  assert.throws(()=>contract.resolveDailyActivityState({status:"CONFIRMED_ZERO"},[{attributedAmount:9800}]));
});
test("sales only attribute existing formal revenue, not add it twice",()=>{
  const first=contract.normalizeAttributionSale(sample);
  const second=contract.normalizeAttributionSale({...sample,saleId:"S002",attributedAmount:5000});
  assert.equal(first.formalRevenueDelta,0);
  assert.deepEqual(contract.resolveDailyActivityState({status:"HAS_SALES"},[first,second]),{
    status:"HAS_SALES",attributedAmount:14800,saleCount:2,formalRevenueDelta:0,
  });
  assert.throws(()=>contract.normalizeAttributionSale({...sample,formalRevenueDelta:9800}));
});
test("HAS_SALES requires real sale entries; no silent conversion from missing",()=>{
  assert.throws(()=>contract.resolveDailyActivityState({status:"HAS_SALES"}));
  assert.throws(()=>contract.resolveDailyActivityState(null,[contract.normalizeAttributionSale(sample)]));
  assert.throws(()=>contract.resolveDailyActivityState({status:"pending"}));
});
test("historical attribution pins immutable version and never current amended publication",()=>{
  const sale=contract.normalizeAttributionSale(sample);
  assert.equal(contract.assertPublishedVersionForSale(sale,{
    brandId:"cyj",campaignId:"campaign_01",versionId:"campaign_01_v001"}),true);
  assert.throws(()=>contract.assertPublishedVersionForSale(sale,{
    brandId:"cyj",campaignId:"campaign_01",versionId:"campaign_01_v002"}));
});
test("brand, account, version, date and sale id all segregate keys",()=>{
  const key=contract.attributionDocumentId(sample,sample.saleId);
  assert.match(key,/^sale_[a-f0-9]{48}$/);
  for (const change of [
    {...sample,brandId:"anniu"},{...sample,accountId:"T002"},
    {...sample,versionId:"campaign_01_v002"},{...sample,reportDate:"2026-10-09"},
    {...sample,saleId:"S002"},
  ]) assert.notEqual(contract.attributionDocumentId(change,change.saleId),key);
});
test("reject malformed dates, unsafe paths, unsupported roles, and amounts",()=>{
  for (const d of ["2026-02-30","2026-13-01","2026/10/08",""]) assert.throws(()=>contract.validIdentity({...sample,reportDate:d}));
  assert.throws(()=>contract.validIdentity({...sample,roleId:"director"}));
  assert.throws(()=>contract.validIdentity({...sample,accountId:" "}));
  assert.throws(()=>contract.validIdentity({...sample,accountId:"T\u0000INJECT"}));
  assert.equal(contract.validIdentity({...sample,accountId:"王小美"}).accountId,"王小美");
  assert.throws(()=>contract.normalizeAttributionSale({...sample,attributedAmount:-1}));
  assert.throws(()=>contract.normalizeAttributionSale({...sample,attributedAmount:12.5}));
  assert.throws(()=>contract.normalizeAttributionSale({...sample,quantity:0}));
});
test("mismatched brand cannot bind a version across tenants",()=>{
  assert.throws(()=>contract.assertPublishedVersionForSale(sample,{
    brandId:"anniu",campaignId:sample.campaignId,versionId:sample.versionId,
  }));
});
test("total must not overflow, malformed records fail closed",()=>{
  const sale=contract.normalizeAttributionSale(sample);
  assert.throws(()=>contract.resolveDailyActivityState({status:"HAS_SALES"},[{...sale,formalRevenueDelta:9800}]));
  assert.throws(()=>contract.resolveDailyActivityState({status:"HAS_SALES"},[null]));
  assert.throws(()=>contract.resolveDailyActivityState({status:"HAS_SALES"},"invalid"));
});

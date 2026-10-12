import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {dayLockDocumentId,assertDayLock,makeDayLock}=require("../functions/activitySalesSpecialPriceDayLock.js");
const identity={brandId:"cyj",campaignId:"act01",versionId:"act01_v001",reportDate:"2026-10-08",roleId:"therapist",accountId:"T001"};
test("B3B2-L2 contract: day id deterministic but partitions all identity dimensions",()=>{
 const id=dayLockDocumentId(identity);
 assert.ok(id.length>32);
 for(const key of Object.keys(identity)){
  const change={...identity,[key]:key==="brandId"?"anniu":key==="roleId"?"store":key==="accountId"?"T002":key==="reportDate"?"2026-10-07":key==="campaignId"?"act02":"act01_v002"};
  if(key==="campaignId")change.versionId="act02_v001";
  if(key==="versionId")change.versionId="act01_v002";
  assert.notEqual(dayLockDocumentId(change),id,key);
 }
});
test("B3B2-L2 contract: immutable day reservation validates exact identity and store",()=>{
 const guard=makeDayLock(identity,"崇學","timestamp","2026-10-09");
 assert.equal(assertDayLock(guard,identity,"崇學"),true);
 for(const bad of [{...guard,brandId:"anniu"},{...guard,storeCore:"中美"},{...guard,state:"RELEASED"},{...guard,formalRevenueDelta:1},{...guard,officialKpiAllocation:"SETTLED"}])
   assert.throws(()=>assertDayLock(bad,identity,"崇學"),/SPECIAL_PRICE_DAY_LOCK_CORRUPT/);
});

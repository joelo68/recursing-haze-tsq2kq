import test from "node:test";
import assert from "node:assert/strict";
import {checkedReviewPage,reviewFromInspect,REVIEW_REASONS} from "../src/utils/activitySalesReviewUiContract.js";
const scope={brandId:"cyj",storeName:"CYJ崇學店",reportDate:"2026-10-08"};
const subject={brandId:"cyj",roleId:"therapist",accountId:"T001",campaignId:"act01",versionId:"act01_v001",reportDate:"2026-10-08"};
const candidate={...subject,status:"HAS_SALES",saleCount:1,attributedAmount:9800,attributionRevision:1,formalRevenueDelta:0};
const page={ok:true,brandId:"cyj",reportDate:"2026-10-08",storeCore:"崇學",maxCandidates:12,
  candidates:[candidate],hasMore:false,nextCursor:null};
test("R2B UI scope requires exact brand/day and non-additive amount",()=>{
  assert.equal(checkedReviewPage(page,scope).candidates.length,1);
  for(const payload of [{...page,brandId:"anniu"},{...page,reportDate:"2026-10-07"},
    {...page,candidates:[{...candidate,formalRevenueDelta:9800}]},
    {...page,candidates:[{...candidate,status:"CONFIRMED_ZERO",saleCount:0,attributedAmount:null}]},
    {...page,candidates:[candidate,candidate]},
    {...page,hasMore:true,nextCursor:null},
    {...page,candidates:Array(13).fill(candidate)}]){
    assert.throws(()=>checkedReviewPage(payload,scope));
  }
});
test("R2B UI single-subject inspect OCC retains revision and nanosecond report version",()=>{
  const inspect={ok:true,subject,status:"HAS_SALES",revision:3,formalRevenueDelta:0,
    reportUpdateVersion:"1790000000:123456789",review:{state:"STALE",reviewRevision:2}};
  assert.deepEqual(reviewFromInspect({inspect,expected:subject}),{
    expectedAttributionRevision:3,expectedReportUpdateVersion:"1790000000:123456789",expectedReviewRevision:2,
  });
  assert.throws(()=>reviewFromInspect({inspect:{...inspect,subject:{...subject,brandId:"yibo"}},expected:subject}));
  assert.throws(()=>reviewFromInspect({inspect:{...inspect,reportUpdateVersion:"1790000000:1"},expected:subject}));
  assert.throws(()=>reviewFromInspect({inspect:{...inspect,revision:0},expected:subject}));
});
test("R2B review reasons are fixed and refunds/corrections are not present",()=>{
  assert.deepEqual(REVIEW_REASONS.map(r=>r.value),["AMOUNT_RECHECK","OWNER_RECHECK","MISSING_EVIDENCE","OTHER"]);
});

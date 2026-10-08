import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {buildAttributionEntry,allowedAttributionActions,checkedAttributionWriteResponse} from "../src/utils/activitySalesAttributionEntry.js";
const publication={status:"published",brandId:"cyj",campaignId:"flash01",versionId:"flash01_v002",
  packages:[{packageId:"pk1",name:"套組",salePrice:9800},{packageId:"pk2",name:"加購",salePrice:2500}]};
const args={publication,status:"UNCONFIRMED",revision:0};
const sale={...args,action:"record_sale",saleId:"cafe-1234-5678",packageId:"pk1",quantity:2};

test("UNCONFIRMED offers explicit sale or zero; HAS_SALES never offers zero",()=>{
  assert.deepEqual(allowedAttributionActions("UNCONFIRMED"),{recordSale:true,confirmZero:true});
  assert.deepEqual(allowedAttributionActions("HAS_SALES"),{recordSale:true,confirmZero:false});
  assert.deepEqual(allowedAttributionActions("CONFIRMED_ZERO"),{recordSale:false,confirmZero:false});
  assert.deepEqual(allowedAttributionActions("unknown"),{recordSale:false,confirmZero:false});
});
test("sale amount comes only from active immutable published package price times quantity",()=>{
  assert.deepEqual(buildAttributionEntry(sale),{action:"record_sale",expectedRevision:0,saleId:"cafe-1234-5678",packageId:"pk1",quantity:2,attributedAmount:19600,formalRevenueDelta:0});
  assert.equal(buildAttributionEntry({...sale,publication:{...publication,packages:[{packageId:"pk1",salePrice:7200}]}}).attributedAmount,14400);
});
test("confirmed zero cannot quietly become a sale or repeat",()=>{
  assert.deepEqual(buildAttributionEntry({...args,action:"confirm_zero"}),{action:"confirm_zero",expectedRevision:0,formalRevenueDelta:0});
  for(const action of ["record_sale","confirm_zero"])
    assert.throws(()=>buildAttributionEntry({...sale,status:"CONFIRMED_ZERO",revision:1,action}),/LOCKED|FORBIDDEN/);
  assert.throws(()=>buildAttributionEntry({...args,status:"HAS_SALES",revision:1,action:"confirm_zero"}),/ZERO_LOCKED/);
});
test("second sale uses checked current revision",()=>{
  assert.equal(buildAttributionEntry({...sale,status:"HAS_SALES",revision:2}).expectedRevision,2);
  assert.throws(()=>buildAttributionEntry({...sale,status:"UNCONFIRMED",revision:3}),/STATE_REVISION/);
  assert.throws(()=>buildAttributionEntry({...sale,revision:-1}),/REVISION_INVALID/);
});
test("rejects invalid quantities, packages, fake sale IDs, forged prices, overflow",()=>{
  for(const quantity of [0,-1,1.5,100,NaN,Infinity])
    assert.throws(()=>buildAttributionEntry({...sale,quantity}),/QUANTITY_INVALID/);
  for(const packageId of ["nope",""])assert.throws(()=>buildAttributionEntry({...sale,packageId}),/PACKAGE_INVALID/);
  for(const saleId of ["", "../escape", "with space"])assert.throws(()=>buildAttributionEntry({...sale,saleId}),/SALE_ID_INVALID/);
  assert.throws(()=>buildAttributionEntry({...sale,publication:{...publication,status:"draft"}}),/PUBLICATION_INVALID/);
  assert.throws(()=>buildAttributionEntry({...sale,publication:{...publication,packages:[{packageId:"pk1",salePrice:2000000}]},quantity:99}),/TOTAL_INVALID/);
});
test("writer successful response must be bound to campaign/version/date and non-additive revenue",()=>{
  const data={ok:true,campaignId:"flash01",versionId:"flash01_v002",reportDate:"2026-10-08",state:"written",status:"HAS_SALES",revision:1,saleCount:2,attributedAmount:19600,formalRevenueDelta:0};
  assert.deepEqual(checkedAttributionWriteResponse(data,publication,"2026-10-08"),{needsRefresh:false,status:"HAS_SALES",revision:1,saleCount:2,attributedAmount:19600,formalRevenueDelta:0});
  for(const diff of [{campaignId:"cross"},{versionId:"old"},{reportDate:"2026-10-09"},{formalRevenueDelta:9800},{revision:0},{saleCount:0}])
    assert.throws(()=>checkedAttributionWriteResponse({...data,...diff},publication,"2026-10-08"),/RESPONSE_INVALID/);
});
test("explicit zero response is 0/0, idempotent only permits refreshed private status",()=>{
  const base={ok:true,campaignId:"flash01",versionId:"flash01_v002",reportDate:"2026-10-08",revision:1};
  assert.deepEqual(checkedAttributionWriteResponse({...base,state:"written",status:"CONFIRMED_ZERO",saleCount:0,attributedAmount:0,formalRevenueDelta:0},publication,"2026-10-08"),{needsRefresh:false,status:"CONFIRMED_ZERO",revision:1,saleCount:0,attributedAmount:0,formalRevenueDelta:0});
  assert.deepEqual(checkedAttributionWriteResponse({...base,state:"idempotent"},publication,"2026-10-08"),{needsRefresh:true});
  assert.throws(()=>checkedAttributionWriteResponse({...base,state:"written",status:"CONFIRMED_ZERO",saleCount:1,attributedAmount:0,formalRevenueDelta:0},publication,"2026-10-08"),/RESPONSE_INVALID/);
});
test("integration guard: isolated UI only, never client writes private Firestore or formal reports",()=>{
  const panel=readFileSync(new URL("../src/components/ActivitySalesAttributionStatusPanel.jsx",import.meta.url),"utf8");
  const form=readFileSync(new URL("../src/components/ActivitySalesAttributionEntryForm.jsx",import.meta.url),"utf8");
  const input=readFileSync(new URL("../src/components/InputView.jsx",import.meta.url),"utf8");
  assert.match(panel,/ACTIVITY_SALES_DEV_MODE/);
  assert.match(form,/ACTIVITY_SALES_DEV_MODE/);
  assert.match(form,/resolveActivitySalesDevFunctionUrl\(WRITER_URL\)/);
  assert.match(form,/credentialPassword:password/);
  assert.match(form,/pending\.current=entry/);
  assert.match(form,/saleReference\.trim\(\)/);
  assert.doesNotMatch(form,/randomUUID/);
  assert.match(form,/onWritten\(checked\)/);
  assert.doesNotMatch(form,/\b(setDoc|updateDoc|addDoc|deleteDoc|onSnapshot|localStorage|sessionStorage)\b/);
  assert.match(input,/ACTIVITY_SALES_DEV_MODE && userRole === "store"/);
  assert.match(input,/ACTIVITY_SALES_DEV_MODE && userRole === "therapist"/);
});

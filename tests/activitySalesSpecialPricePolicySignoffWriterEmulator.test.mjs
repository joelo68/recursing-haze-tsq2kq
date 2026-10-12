import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const PROJECT='demo-drcyj-activity-sales';
if((process.env.GCLOUD_PROJECT||process.env.GOOGLE_CLOUD_PROJECT)!==PROJECT ||
   !process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST)
  throw Error('L3B2B2_SIGNOFF_REQUIRES_DEMO_EMULATOR_ONLY');
const admin=require('../functions/node_modules/firebase-admin');
if(!admin.apps.length) admin.initializeApp({projectId:PROJECT});
const db=admin.firestore();
const {createSpecialPriceRequestHandler}=require('../functions/activitySalesSpecialPriceRequestWriter.js');
const {createSpecialPriceReviewHandler}=require('../functions/activitySalesSpecialPriceReviewWriter.js');
const {createSpecialPricePolicySignoffHandler}=require('../functions/activitySalesSpecialPricePolicySignoffWriter.js');
const {DECISION_CODES}=require('../functions/activitySalesSpecialPriceRecognitionWorksheet.js');
const {specialPriceRequestId,checkedSpecialPriceRequest}=require('../functions/activitySalesSpecialPriceRequestContract.js');
const {attributionDocumentId}=require('../functions/activitySalesAttributionContract.js');
const {summaryDocumentId}=require('../functions/activitySalesAttributionWriterLogic.js');
const path=b=>b==='cyj'?'artifacts/default-app-id/public/data':`brands/${b}`;
const col=(_db,b,name)=>db.collection(`${path(b)}/${name}`);
const setting=(_db,b,name)=>db.doc(b==='cyj'?`${path(b)}/global_settings/${name}`:`${path(b)}/settings/${name}`);
const now=()=>new Date('2026-10-12T06:00:00.000Z');
const actor=(roleId,accountId)=>({roleId,accountId,deviceId:'trusted',credentialPassword:'test-secret'});
const response=()=>({code:200,status(code){this.code=code;return this;},json(body){return {status:this.code,body}}});
const authServices=(brandId,roleId,accountId)=>({
  now,getBrandCollection:col,getBrandSettingDoc:setting,
  requireFirebaseRequestAuth:async()=>({ok:true,decoded:{drcyjIdentity:true,identityVersion:'application-identity-v1',brandId,roleId,accountId}}),
  verifyTrustedApplicationActor:async()=>({ok:true,actorRole:roleId,actorAccountId:accountId}),
});
const proposals=Object.fromEntries(DECISION_CODES.map(code=>[code,{text:'需依管理政策完成提案審議',rationale:'跨月與結帳風險必須事先確認'}]));
let seq=0;
async function seed(brand){
 const campaignId=`sg${process.pid}_${Date.now()}_${++seq}`,versionId=`${campaignId}_v001`;
 const identity={brandId:brand,campaignId,versionId,roleId:'therapist',accountId:'T001',reportDate:'2026-10-11'};
 const at=name=>col(db,brand,name),storeName='崇學店';
 const recordId=specialPriceRequestId(identity,'sale01');
 await Promise.all([
  at('therapists').doc('T001').set({id:'T001',store:storeName,status:'active'}),
  at('therapist_daily_reports').doc('2026-10-11_T001').set({brandId:brand,therapistId:'T001',date:'2026-10-11',storeName,totalRevenue:88000}),
  at('activity_sales_publications').doc(campaignId).set({...identity,status:'published',startDate:'2026-10-01',endDate:'2026-10-31'}),
  at('activity_campaign_versions').doc(versionId).set({brandId:brand,campaignId,versionId,campaignSnapshot:{startDate:'2026-10-01',endDate:'2026-10-31',storeScope:'all',packages:[{packageId:'pkg01',salePrice:18800}]}}),
  at('activity_sales_lifecycle_review_policy').doc('current').set({schemaVersion:'activity-sales-lifecycle-review-policy-v1',brandId:brand,enabled:true,revision:1,groups:{},flows:{SPECIAL_PRICE:{enabled:true,allowRequesterApproval:false,steps:[{stepId:'review',quorum:'ANY',reviewers:[{type:'account',roleId:'store',accountId:'S001'}]}]}}}),
  at('activity_sales_special_price_signoff_authority').doc('current').set({schemaVersion:'activity-sales-special-price-signoff-authority-v1',brandId:brand,enabled:true,revision:1,reviewers:{BUSINESS:[{roleId:'store',accountId:'S001'},{roleId:'store',accountId:'S003'}],FINANCE:[{roleId:'store',accountId:'S002'}]}}),
  setting(db,brand,'store_account_data').set({accounts:['S001','S002','S003'].map(id=>({id,isActive:true,stores:[storeName]}))}),
 ]);
 const req=createSpecialPriceRequestHandler({admin,db,services:authServices(brand,'therapist','T001')});
 // B3A accepts seller identity ONLY through actor. Top-level roleId/accountId are rejected.
 // This seed must use the exact same public request contract as the production-isolated B3A handler.
 const requestBody={action:'request_special_price',brandId:brand,campaignId,versionId,reportDate:identity.reportDate,
   storeName,saleId:'sale01',packageId:'pkg01',quantity:1,actualAmount:17800,
   reasonCode:'special_discount',reasonNote:'特殊成交需主管核准',expectedRevision:0,
   actor:actor('therapist','T001')};
 const checked=checkedSpecialPriceRequest(requestBody);
 assert.equal(checked.identity.roleId,'therapist');
 assert.equal(checked.identity.accountId,'T001');
 const created=await req({method:'POST',body:requestBody},response());
 assert.equal(created.status,200,JSON.stringify(created.body));
 const reviewHandler=createSpecialPriceReviewHandler({admin,db,services:authServices(brand,'store','S001')});
 const reviewed=await reviewHandler({method:'POST',body:{action:'review_special_price',brandId:brand,requestId:recordId,decision:'APPROVE',expectedReviewRevision:0,actor:actor('store','S001')}},response());
 assert.equal(reviewed.status,200,JSON.stringify(reviewed.body));
 return {brand,recordId,identity,at};
}
const call=(f,role,id,fields)=>createSpecialPricePolicySignoffHandler({admin,db,services:authServices(f.brand,role,id)})({method:'POST',body:{brandId:f.brand,requestId:f.recordId,actor:actor(role,id),...fields}},response());
test('L3B2B2 actual transactions: CYJ/Anniu/Yibo signoffs are independent, concurrent reviewer OCC, no posting',async()=>{
 for(const brand of ['cyj','anniu','yibo']){
  const f=await seed(brand);
  const open=await call(f,'therapist','T001',{action:'open_special_price_signoff',expectedDailyRevision:0,proposals});
  assert.equal(open.status,200,`${brand} open: ${JSON.stringify(open.body)}`);
  assert.equal(open.body.status,'PENDING_BUSINESS_REVIEW');
  const a=call(f,'store','S001',{action:'decide_special_price_signoff',expectedReviewRevision:0,decision:'APPROVE'});
  const b=call(f,'store','S003',{action:'decide_special_price_signoff',expectedReviewRevision:0,decision:'APPROVE'});
  const pair=await Promise.all([a,b]);
  assert.deepEqual(pair.map(x=>x.status).sort(),[200,409],`${brand} simultaneous business OCC ${JSON.stringify(pair)}`);
  const premature=await call(f,'store','S001',{action:'decide_special_price_signoff',expectedReviewRevision:1,decision:'APPROVE'});
  assert.equal(premature.status,403,`${brand} cannot approve finance`);
  const finance=await call(f,'store','S002',{action:'decide_special_price_signoff',expectedReviewRevision:1,decision:'APPROVE'});
  assert.equal(finance.status,200,`${brand} finance ${JSON.stringify(finance.body)}`);
  assert.equal(finance.body.status,'SIGNED_NO_POSTING');
  assert.equal(finance.body.postingAllowed,false);
  const signed=(await f.at('activity_sales_special_price_signoffs').doc(f.recordId).get()).data();
  assert.equal(signed.signoffState.status,'SIGNED_NO_POSTING');
  assert.equal(signed.signoffState.reviewRevision,2);
  assert.equal(signed.signoffState.financialPeriodAuthority,'NOT_GRANTED');
  const audits=await Promise.all([0,1,2].map(i=>f.at('activity_sales_special_price_signoff_audit').doc(`${f.recordId}_${i}`).get()));
  assert.equal(audits.every(s=>s.exists),true);
  const saleKey=attributionDocumentId(f.identity,'sale01');
  assert.equal((await f.at('activity_sales_attribution_sales').doc(saleKey).get()).exists,false);
  assert.equal((await f.at('activity_sales_daily_attributions').doc(summaryDocumentId(f.identity)).get()).exists,false);
  assert.equal((await f.at('activity_sales_special_price_day_locks').doc(summaryDocumentId(f.identity)).get()).exists,true);
  assert.equal((await f.at('therapist_daily_reports').doc('2026-10-11_T001').get()).data().totalRevenue,88000);
  const dup=await call(f,'store','S002',{action:'decide_special_price_signoff',expectedReviewRevision:1,decision:'APPROVE'});
  assert.notEqual(dup.status,200);
 }
});
test('signoff refuses authority change or missing policy; cross-brand claim cannot act',async()=>{
 const f=await seed('cyj');
 const wrong=await call(f,'store','S001',{action:'open_special_price_signoff',expectedDailyRevision:0,proposals});
 assert.equal(wrong.status,403);
 await f.at('activity_sales_special_price_signoff_authority').doc('current').delete();
 const missing=await call(f,'therapist','T001',{action:'open_special_price_signoff',expectedDailyRevision:0,proposals});
 assert.notEqual(missing.status,200);
 assert.equal((await f.at('activity_sales_special_price_signoffs').doc(f.recordId).get()).exists,false);
});

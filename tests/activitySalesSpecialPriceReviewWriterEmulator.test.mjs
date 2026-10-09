import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const PROJECT='demo-drcyj-activity-sales';
if((process.env.GCLOUD_PROJECT||process.env.GOOGLE_CLOUD_PROJECT)!==PROJECT ||
  !process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST)
  throw Error('B3B1_REVIEW_EMULATOR_REQUIRES_DEMO_ONLY');
const admin=require('../functions/node_modules/firebase-admin');
if(!admin.apps.length)admin.initializeApp({projectId:PROJECT});
const db=admin.firestore();
const {createSpecialPriceRequestHandler}=require('../functions/activitySalesSpecialPriceRequestWriter.js');
const {createSpecialPriceReviewHandler}=require('../functions/activitySalesSpecialPriceReviewWriter.js');
const {specialPriceRequestId}=require('../functions/activitySalesSpecialPriceRequestContract.js');
const {attributionDocumentId}=require('../functions/activitySalesAttributionContract.js');
const {summaryDocumentId}=require('../functions/activitySalesAttributionWriterLogic.js');
const prefix=b=>b==='cyj'?'artifacts/default-app-id/public/data':`brands/${b}`;
const col=(_db,b,name)=>db.collection(`${prefix(b)}/${name}`);
const settings=(_db,b,name)=>db.doc(`${prefix(b)}/settings/${name}`);
const now=new Date('2026-10-09T06:00:00.000Z');let seq=0;
function res(){return {code:200,status(code){this.code=code;return this;},json(body){return {status:this.code,body}}};}
async function seed(brand){
  const campaignId=`special_review_${process.pid}_${++seq}_${Date.now()}`,versionId=`${campaignId}_v001`,reportDate='2026-10-08';
  const identity={brandId:brand,campaignId,versionId,reportDate,roleId:'therapist',accountId:'T001'};
  const at=name=>col(db,brand,name);
  const storeName='崇學店',reportRef=at('therapist_daily_reports').doc(`${reportDate}_T001`);
  await Promise.all([
    at('therapists').doc('T001').set({id:'T001',store:storeName,status:'active'}),
    reportRef.set({brandId:brand,therapistId:'T001',date:reportDate,storeName,totalRevenue:86400}),
    at('activity_sales_publications').doc(campaignId).set({...identity,status:'published',startDate:'2026-10-01',endDate:'2026-10-31'}),
    at('activity_campaign_versions').doc(versionId).set({brandId:brand,campaignId,versionId,campaignSnapshot:{
      startDate:'2026-10-01',endDate:'2026-10-31',storeScope:'all',packages:[{packageId:'pkg01',salePrice:18800}]}}),
    at('activity_sales_lifecycle_review_policy').doc('current').set({schemaVersion:'activity-sales-lifecycle-review-policy-v1',
      brandId:brand,enabled:true,revision:1,groups:{},flows:{SPECIAL_PRICE:{enabled:true,allowRequesterApproval:false,
        steps:[{stepId:'a1',quorum:'ANY',reviewers:[{type:'account',roleId:'store',accountId:'S001'},
          {type:'account',roleId:'store',accountId:'S002'}]}]}}}),
    settings(db,brand,'store_account_data').set({accounts:[{id:'S001',stores:[storeName],isActive:true},
      {id:'S002',stores:[storeName],isActive:true}]}),
  ]);
  const requestHandler=createSpecialPriceRequestHandler({admin,db,services:{now:()=>now,getBrandCollection:col,
    getBrandSettingDoc:settings,
    requireFirebaseRequestAuth:async()=>({ok:true,decoded:{drcyjIdentity:true,identityVersion:'application-identity-v1',brandId:brand,
      roleId:'therapist',accountId:'T001'}}),
    verifyTrustedApplicationActor:async()=>({ok:true,actorRole:'therapist',actorAccountId:'T001'})}});
  const request=await requestHandler({method:'POST',body:{action:'request_special_price',brandId:brand,campaignId,versionId,
    reportDate,storeName,saleId:'sale01',packageId:'pkg01',quantity:1,actualAmount:17800,reasonCode:'special_discount',
    reasonNote:'員工提出折扣申請',expectedRevision:0,actor:{roleId:'therapist',accountId:'T001',deviceId:'dev',credentialPassword:'demo'}}},res());
  assert.equal(request.status,200,JSON.stringify(request.body));
  const requestId=specialPriceRequestId(identity,'sale01');
  return {identity,requestId,reportRef,at};
}
test('B3B1 transaction: 3 brands exactly one concurrent reviewer wins; neither creates sale nor changes revenue',async()=>{
  for(const brand of ['cyj','anniu','yibo']){
    const f=await seed(brand);
    const makeCall=who=>{
      const handler=createSpecialPriceReviewHandler({admin,db,services:{now:()=>now,getBrandCollection:col,getBrandSettingDoc:settings,
        requireFirebaseRequestAuth:async()=>({ok:true,decoded:{drcyjIdentity:true,identityVersion:'application-identity-v1',
          brandId:brand,roleId:'store',accountId:who}}),
        verifyTrustedApplicationActor:async()=>({ok:true,actorRole:'store',actorAccountId:who})}});
      return ()=>handler({method:'POST',body:{action:'review_special_price',brandId:brand,requestId:f.requestId,
        decision:'APPROVE',expectedReviewRevision:0,actor:{roleId:'store',accountId:who,deviceId:'dev',credentialPassword:'demo'}}},res());
    };
    const a=makeCall('S001'),b=makeCall('S002');
    const outcomes=await Promise.all([a(),b()]);
    assert.deepEqual(outcomes.map(x=>x.status).sort(),[200,409],`${brand} strict OCC`);
    const winner=outcomes[0].status===200?a:b;
    const retry=await winner();assert.equal(retry.status,200);assert.equal(retry.body.state,'idempotent');
    const review=await f.at('activity_sales_special_price_review_state').doc(f.requestId).get();
    assert.equal(review.data().status,'APPROVED_PENDING_SETTLEMENT');assert.equal(review.data().reviewRevision,1);
    assert.equal(review.data().formalRevenueDelta,0);
    const req=await f.at('activity_sales_special_price_requests').doc(f.requestId).get();
    assert.equal(req.data().state,'PENDING_REVIEW');
    assert.equal(req.data().reportDocId,`2026-10-08_T001`);
    const saleKey=attributionDocumentId(f.identity,'sale01');
    assert.equal((await f.at('activity_sales_attribution_sales').doc(saleKey).get()).exists,false);
    assert.equal((await f.at('activity_sales_daily_attributions').doc(summaryDocumentId(f.identity)).get()).exists,false);
    assert.equal((await f.reportRef.get()).data().totalRevenue,86400);
  }
});

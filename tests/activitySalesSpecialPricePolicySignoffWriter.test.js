import {createRequire} from 'node:module';
import test from 'node:test';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {createSpecialPricePolicySignoffHandler,checkedBody}=require('../functions/activitySalesSpecialPricePolicySignoffWriter.js');
const {DECISION_CODES}=require('../functions/activitySalesSpecialPriceRecognitionWorksheet.js');
const {specialPriceRequestId,buildSpecialPriceRequest}=require('../functions/activitySalesSpecialPriceRequestContract.js');
const {parsePlan,applyDecision}=require('../functions/activitySalesLifecycleReviewPolicy.js');
const {validIdentity,attributionDocumentId}=require('../functions/activitySalesAttributionContract.js');
const {summaryDocumentId}=require('../functions/activitySalesAttributionWriterLogic.js');
const {makeDayLock}=require('../functions/activitySalesSpecialPriceDayLock.js');
const store='崇學店';
const prefix=b=>b==='cyj'?'artifacts/default-app-id/public/data':`brands/${b}`;
const proposalList=Object.fromEntries(DECISION_CODES.map(code=>[code,{text:'活動特殊價待審核認列方案',rationale:'先核對跨月關帳及正式營收不重複'}]));
const actor=(roleId,accountId)=>({roleId,accountId,deviceId:'d',credentialPassword:'dev'});
function fixture(brand='cyj',options={}){
  const docs=new Map(),writes=[];
  const identity=validIdentity({brandId:brand,campaignId:'campaign01',versionId:'campaign01_v001',reportDate:'2026-10-11',roleId:'therapist',accountId:'T001'});
  const requestId=specialPriceRequestId(identity,'sale01'),saleKey=attributionDocumentId(identity,'sale01');
  const key=(b,collection,id)=>`${prefix(b)}/${collection}/${id}`;
  const put=(collection,id,data)=>docs.set(key(brand,collection,id),data);
  const rawProposal=buildSpecialPriceRequest({identity,saleId:'sale01',packageId:'pkg01',quantity:1,actualAmount:17800,reasonCode:'special_discount',reasonNote:'單次特殊折讓'},18800);
  const policy={schemaVersion:'activity-sales-lifecycle-review-policy-v1',brandId:brand,revision:1,enabled:true,groups:{},flows:{SPECIAL_PRICE:{enabled:true,allowRequesterApproval:false,steps:[{stepId:'review',quorum:'ANY',reviewers:[{type:'account',roleId:'store',accountId:'S001'}]}]}}};
  const reviewPlan=parsePlan(policy,'SPECIAL_PRICE',brand);
  const originalRequest={schemaVersion:'activity-sales-special-price-request-record-v1',...identity,
    requestId,saleId:'sale01',proposal:rawProposal,requestedByRole:'therapist',requestedByAccountId:'T001',
    policyRevision:reviewPlan.policyRevision,planHash:reviewPlan.planHash,state:'PENDING_REVIEW',
    storeCore:'崇學',storeName:store,reportDocId:'2026-10-11_T001',formalRevenueDelta:0,
    officialKpiAllocation:'UNDECIDED',createdAtText:'2026-10-11T12:00:00.000Z'};
  const review=applyDecision({requestId,request:originalRequest,plan:reviewPlan,prior:null,
    actor:{roleId:'store',accountId:'S001'},decision:'APPROVE',expectedReviewRevision:0});
  review.updatedAtText='2026-10-12T03:00:00.000Z';
  put('therapists','T001',{id:'T001',store,status:'active'});
  put('therapist_daily_reports','2026-10-11_T001',{brandId:brand,therapistId:'T001',date:'2026-10-11',storeName:store,totalRevenue:88000});
  put('activity_sales_publications','campaign01',{...identity,status:'published',startDate:'2026-10-01',endDate:'2026-10-31'});
  put('activity_campaign_versions','campaign01_v001',{brandId:brand,campaignId:'campaign01',versionId:'campaign01_v001',campaignSnapshot:{startDate:'2026-10-01',endDate:'2026-10-31',storeScope:'all',packages:[{packageId:'pkg01',salePrice:18800}]}});
  put('activity_sales_lifecycle_review_policy','current',policy);
  put('activity_sales_special_price_requests',requestId,originalRequest);
  put('activity_sales_special_price_review_state',requestId,review);
  put('activity_sales_special_price_request_state',saleKey,{schemaVersion:'activity-sales-special-price-request-state-v1',...identity,saleId:'sale01',requestId,state:'PENDING_REVIEW',requestRevision:1,storeCore:'崇學',storeName:store,reportDocId:'2026-10-11_T001',formalRevenueDelta:0,officialKpiAllocation:'UNDECIDED'});
  put('activity_sales_special_price_day_locks',summaryDocumentId(identity),makeDayLock(identity,'崇學',null,'2026-10-11T12:00:00.000Z'));
  put('activity_sales_special_price_signoff_authority','current',{schemaVersion:'activity-sales-special-price-signoff-authority-v1',brandId:brand,revision:1,enabled:true,reviewers:{BUSINESS:[{roleId:'store',accountId:'S001'}],FINANCE:[{roleId:'store',accountId:'S002'}]}});
  const storeSettings=brand==='cyj'?`artifacts/default-app-id/public/data/global_settings/store_account_data`:`brands/${brand}/settings/store_account_data`;
  docs.set(storeSettings,{accounts:['S001','S002'].map(id=>({id,isActive:true,stores:[store]}))});
  function dbRef(path){return {path,id:path.split('/').at(-1)};}
  const db={
    collection(path){return {doc(id){return dbRef(`${path}/${id}`)}}},
    doc(path){return dbRef(path)},
    async runTransaction(fn){const pending=[];const tx={
      get:async ref=>({exists:docs.has(ref.path),data:()=>docs.get(ref.path)}),
      create:(ref,data)=>pending.push({action:'create',ref,data}),
      set:(ref,data)=>pending.push({action:'set',ref,data}),
    };const result=await fn(tx);for(const w of pending){if(w.action==='create'&&docs.has(w.ref.path))throw Error('ALREADY_EXISTS');docs.set(w.ref.path,w.data);writes.push(w.ref.path)}return result;},
  };
  const settings=(_db,b,name)=>dbRef(b==='cyj'?`artifacts/default-app-id/public/data/global_settings/${name}`:`brands/${b}/settings/${name}`);
  const services={now:()=>new Date('2026-10-12T06:00:00.000Z'),
    getBrandCollection:(_db,b,name)=>db.collection(`${prefix(b)}/${name}`),
    getBrandSettingDoc:settings,
    requireFirebaseRequestAuth:async()=>({ok:true,decoded:{drcyjIdentity:true,identityVersion:'application-identity-v1',brandId:brand,roleId:currentRole,accountId:currentAccount}}),
    verifyTrustedApplicationActor:async()=>({ok:options.trusted!==false,actorRole:currentRole,actorAccountId:currentAccount})};
  let currentRole='therapist',currentAccount='T001';
  async function call(role,id,fields){currentRole=role;currentAccount=id;const handler=createSpecialPricePolicySignoffHandler({db,admin:{firestore:{FieldValue:{serverTimestamp:()=>({__serverTimestamp:true})}}},services});
    const res={code:200,status(code){this.code=code;return this;},json(body){return {status:this.code,body}}};
    return handler({method:'POST',body:{brandId:brand,requestId,actor:actor(role,id),...fields}},res);
  }
  const open=()=>call('therapist','T001',{action:'open_special_price_signoff',expectedDailyRevision:0,proposals:proposalList});
  const approve=(who='S001',rev=0)=>call('store',who,{action:'decide_special_price_signoff',expectedReviewRevision:rev,decision:'APPROVE'});
  return {docs,writes,open,approve,call,put,brand,requestId,storeSettings,identity};
}
for(const brand of ['cyj','anniu','yibo']){
  test(`${brand} opens then signs, without activity posting`,async()=>{
    const f=fixture(brand);const open=await f.open();assert.equal(open.status,200,JSON.stringify(open.body));
    const bus=await f.approve();assert.equal(bus.status,200,JSON.stringify(bus.body));
    const fin=await f.approve('S002',1);assert.equal(fin.status,200,JSON.stringify(fin.body));
    assert.equal(fin.body.status,'SIGNED_NO_POSTING');assert.equal(fin.body.postingAllowed,false);
    assert.equal(f.writes.length,6);assert.ok(f.writes.every(p=>p.startsWith(prefix(brand)+'/')));
    assert.equal([...f.docs.keys()].filter(k=>k.includes('activity_sales_attribution_sales/')).length,0);
    assert.equal([...f.docs.values()].find(x=>x?.totalRevenue===88000)?.totalRevenue,88000);
    assert.notEqual((await f.approve('S002',1)).status,200);
  });
  test(`${brand} cannot skip finance or self-approve`,async()=>{
    const f=fixture(brand);assert.equal((await f.open()).status,200);
    assert.equal((await f.approve('S002',0)).status,403);
    assert.equal((await f.approve()).status,200);
    assert.equal((await f.approve('S001',1)).status,403);
  });
}
test('missing brand authority, changed seller, changed price, daily revision and locked daily all fail closed',async()=>{
  for(const option of ['missing','seller','price','daily','zero']){
    const f=fixture();
    if(option==='missing')f.docs.delete(`${prefix('cyj')}/activity_sales_special_price_signoff_authority/current`);
    if(option==='seller')f.docs.set(`${prefix('cyj')}/therapists/T001`,{id:'T001',store:'異店',status:'active'});
    if(option==='price')f.docs.get(`${prefix('cyj')}/activity_campaign_versions/campaign01_v001`).campaignSnapshot.packages[0].salePrice=16800;
    if(option==='daily')f.put('activity_sales_daily_attributions',summaryDocumentId(f.identity),{status:'HAS_SALES',revision:2});
    if(option==='zero')f.put('activity_sales_daily_attributions',summaryDocumentId(f.identity),{status:'CONFIRMED_ZERO',revision:1});
    assert.notEqual((await f.open()).status,200,option);assert.equal(f.writes.length,0,option);
  }
});
test('new input rejects invented posting authority / invalid actor fields',()=>{
 for(const changes of [{postingAllowed:true},{formalRevenueDelta:1},{proposals:{}},{actor:{roleId:'director',accountId:'root',root:true}}]){
  assert.throws(()=>checkedBody({action:'open_special_price_signoff',brandId:'cyj',requestId:'price_'+'a'.repeat(48),expectedDailyRevision:0,proposals:proposalList,actor:actor('therapist','T001'),...changes}));
 }
});
test('draft tampering and authority revision drift refuse signature',async()=>{
 const f=fixture();assert.equal((await f.open()).status,200);
 const policy=f.docs.get(`${prefix('cyj')}/activity_sales_special_price_signoff_authority/current`);policy.revision=2;
 assert.notEqual((await f.approve()).status,200);
});
test('named therapist reviewer cannot sign for a different store',async()=>{
 const f=fixture();
 const auth=f.docs.get(`${prefix('cyj')}/activity_sales_special_price_signoff_authority/current`);
 auth.reviewers.BUSINESS=[{roleId:'therapist',accountId:'T002'}];
 f.put('therapists','T002',{id:'T002',store:'不同店',status:'active'});
 assert.equal((await f.open()).status,200);
 const r=await f.call('therapist','T002',{action:'decide_special_price_signoff',expectedReviewRevision:0,decision:'APPROVE'});
 assert.equal(r.status,403,JSON.stringify(r.body));
 assert.equal(f.writes.length,2);
});

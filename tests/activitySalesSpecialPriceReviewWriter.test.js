import {createRequire} from 'node:module';
import test from 'node:test';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {createSpecialPriceReviewHandler}=require('../functions/activitySalesSpecialPriceReviewWriter.js');
const {applyDecision,parsePlan}=require('../functions/activitySalesLifecycleReviewPolicy.js');
const {buildSpecialPriceRequest,specialPriceRequestId}=require('../functions/activitySalesSpecialPriceRequestContract.js');
const {attributionDocumentId}=require('../functions/activitySalesAttributionContract.js');
const NOW=new Date('2026-10-09T03:00:00.000Z');
const base=b=>b==='cyj'?'artifacts/default-app-id/public/data':`brands/${b}`;
const ident=b=>({brandId:b,campaignId:'camp01',versionId:'camp01_v001',roleId:'therapist',accountId:'T001',reportDate:'2026-10-08'});
const policy=b=>({schemaVersion:'activity-sales-lifecycle-review-policy-v1',brandId:b,enabled:true,revision:1,groups:{},
  flows:{SPECIAL_PRICE:{enabled:true,allowRequesterApproval:false,steps:[{stepId:'s1',quorum:'ANY',reviewers:[{type:'account',roleId:'store',accountId:'S001'}]}]}}});
const snap=data=>({exists:data!==undefined,data:()=>data});
function fixture({brand='cyj',claimedBrand=brand,requester='therapist',trusted=true,missingPolicy=false,staleVersion=false,
                  activeReviewer=true,wrongStore=false,priorSale=false,storeRole=false}={}){
  const dbdocs=new Map(),writes=[],identity={...ident(brand),roleId:storeRole?'store':'therapist',accountId:storeRole?'S002':'T001'};
  const col=(name,id)=>`${base(brand)}/${name}/${id}`;
  const put=(name,id,data)=>dbdocs.set(col(name,id),data);
  const expected=buildSpecialPriceRequest({identity,saleId:'sale01',packageId:'pkg01',quantity:1,
    actualAmount:17800,reasonCode:'special_discount',reasonNote:'特別折扣申請'},18800);
  const requestId=specialPriceRequestId(identity,'sale01'),saleKey=attributionDocumentId(identity,'sale01');
  const storeName='CYJ崇學店';const reportDocId=storeRole?'2026-10-08_CYJ崇學店':'2026-10-08_T001';
  const request={schemaVersion:'activity-sales-special-price-request-record-v1',...identity,saleId:'sale01',storeCore:'崇學',storeName,
    reportDocId,requestId,proposal:expected,requestedByRole:requester,requestedByAccountId:requester==='store'?'S001':identity.accountId,
    state:'PENDING_REVIEW',policyRevision:1,planHash:parsePlan(policy(brand),'SPECIAL_PRICE',brand).planHash,
    formalRevenueDelta:0,officialKpiAllocation:'UNDECIDED'};
  put('activity_sales_special_price_requests',requestId,request);
  put('activity_sales_special_price_request_state',saleKey,{schemaVersion:'activity-sales-special-price-request-state-v1',
    ...identity,requestId,state:'PENDING_REVIEW',requestRevision:1,storeCore:'崇學',storeName,reportDocId,formalRevenueDelta:0,officialKpiAllocation:'UNDECIDED'});
  if(!missingPolicy)put('activity_sales_lifecycle_review_policy','current',policy(brand));
  put('settings','store_account_data',{accounts:[
    {id:'S001',stores:[wrongStore?'CYJ西門店':'CYJ崇學店'],isActive:activeReviewer,password:'test'},
    {id:'S002',stores:['CYJ崇學店'],isActive:true,password:'test'}]});
  put('therapists','T001',{id:'T001',store:'CYJ崇學店',status:'active'});
  put(storeRole?'daily_reports':'therapist_daily_reports',reportDocId,{
    date:identity.reportDate,brandId:brand,storeName, ...(storeRole?{}:{therapistId:'T001'}),totalRevenue:86400});
  put('activity_sales_publications','camp01',{...identity,status:'published',startDate:'2026-10-01',endDate:'2026-10-31'});
  put('activity_campaign_versions','camp01_v001',{brandId:brand,campaignId:'camp01',versionId:'camp01_v001',campaignSnapshot:{
    startDate:'2026-10-01',endDate:'2026-10-31',storeScope:'all',packages:[{packageId:'pkg01',salePrice:staleVersion?19000:18800}]}});
  if(priorSale)put('activity_sales_attribution_sales',saleKey,{...identity,saleId:'sale01'});
  const fakeDb={runTransaction:async fn=>{
    const changes=[];
    const tx={get:async ref=>snap(dbdocs.get(ref.path)),create:(ref,data)=>changes.push({method:'create',ref,data}),
      set:(ref,data)=>changes.push({method:'set',ref,data})};
    const result=await fn(tx);
    for(const {method,ref} of changes)if(method==='create'&&dbdocs.has(ref.path))throw Error('EXISTS');
    for(const {ref,data} of changes){dbdocs.set(ref.path,data);writes.push(ref.path);}
    return result;
  }};
  const handler=createSpecialPriceReviewHandler({admin:{firestore:{FieldValue:{serverTimestamp:()=>NOW.toISOString()}}},db:fakeDb,
    services:{now:()=>NOW,getBrandCollection:(_db,b,name)=>({doc:id=>({path:`${base(b)}/${name}/${id}`,id})}),
      getBrandSettingDoc:(_db,b,name)=>({path:`${base(b)}/settings/${name}`,id:name}),
      requireFirebaseRequestAuth:async()=>({ok:true,decoded:{drcyjIdentity:true,identityVersion:'application-identity-v1',
        brandId:claimedBrand,roleId:'store',accountId:'S001'}}),
      verifyTrustedApplicationActor:async()=>trusted?{ok:true,actorRole:'store',actorAccountId:'S001'}:{ok:false}}});
  const call=async changes=>{
    const req={method:'POST',body:{action:'review_special_price',brandId:brand,requestId,decision:'APPROVE',expectedReviewRevision:0,
      actor:{roleId:'store',accountId:'S001',deviceId:'dev001',credentialPassword:'test'},...changes}};
    const res={code:200,status(v){this.code=v;return this;},json(data){return {status:this.code,data}}};
    return handler(req,res);
  };
  return {call,dbdocs,writes,requestId,saleKey,brand};
}
test('policy: life_ and price_ review share the same quorum and refuse mixed kinds',()=>{
  const brand='cyj',plan=parsePlan(policy(brand),'SPECIAL_PRICE',brand);
  const id=ident(brand),proposal=buildSpecialPriceRequest({identity:id,saleId:'sale01',packageId:'pkg01',quantity:1,actualAmount:17800,
    reasonCode:'special_discount',reasonNote:'理由已填'},18800);
  const requestId=specialPriceRequestId(id,'sale01');
  const request={brandId:brand,requestId,state:'PENDING_REVIEW',requestedByRole:'therapist',requestedByAccountId:'T001',proposal};
  const next=applyDecision({requestId,request,plan,actor:{roleId:'store',accountId:'S001'},decision:'APPROVE',expectedReviewRevision:0});
  assert.equal(next.status,'APPROVED_PENDING_SETTLEMENT');assert.equal(next.formalRevenueDelta,0);
  assert.throws(()=>applyDecision({requestId:`life_${'a'.repeat(48)}`,request,plan,
    actor:{roleId:'store',accountId:'S001'},decision:'APPROVE',expectedReviewRevision:0}),/LIFECYCLE_REVIEW_REQUEST_INVALID/);
});
test('writer: three brands append review decision, never sale or revenue',async()=>{
  for(const brand of ['cyj','anniu','yibo']){
    const f=fixture({brand}),r=await f.call();
    assert.equal(r.status,200,`${brand} ${r.data.code}`);assert.equal(r.data.status,'APPROVED_PENDING_SETTLEMENT');
    assert.equal(r.data.formalRevenueDelta,0);assert.equal(r.data.officialKpiAllocation,'UNDECIDED');
    assert.deepEqual(f.writes.map(x=>x.split('/').at(-2)).sort(),
      ['activity_sales_special_price_review_decisions','activity_sales_special_price_review_state'].sort());
    assert.ok(f.writes.every(x=>x.startsWith(`${base(brand)}/`)));
    assert.equal(f.dbdocs.has(`${base(brand)}/activity_sales_attribution_sales/${f.saleKey}`),false);
    assert.equal((await f.call()).data.state,'idempotent');assert.equal(f.writes.length,2);
  }
});
test('writer: stale version, active membership, policy, existing sale and identity fail closed',async()=>{
  for(const opts of [{claimedBrand:'anniu'},{trusted:false},{missingPolicy:true},{staleVersion:true},
    {activeReviewer:false},{wrongStore:true},{priorSale:true}]){
    const f=fixture(opts),r=await f.call();assert.notEqual(r.status,200,JSON.stringify(opts));assert.equal(f.writes.length,0);
  }
});
test('writer: once reviewed stale OCC and mutation fail, old exact replay remains idempotent',async()=>{
  const f=fixture();assert.equal((await f.call()).status,200);
  for(const changes of [{decision:'REJECT'},{expectedReviewRevision:1},{settled:true},{formalRevenueDelta:100},{requestId:`life_${'a'.repeat(48)}`}]){
    const r=await f.call(changes);assert.notEqual(r.status,200,JSON.stringify(changes));assert.equal(f.writes.length,2);
  }
});
test('writer: seller store account uses persisted exact report document id',async()=>{
  const f=fixture({storeRole:true}),r=await f.call();assert.equal(r.status,200,r.data.code);
  assert.equal(f.dbdocs.get(`${base('cyj')}/activity_sales_special_price_requests/${f.requestId}`).reportDocId,'2026-10-08_CYJ崇學店');
});
test('writer: malformed request does not start transaction',async()=>{
  const f=fixture();for(const changes of [{actor:{roleId:'store',accountId:'S001',deviceId:'d',credentialPassword:'x',isAdmin:true}},
    {expectedReviewRevision:-1},{reasonNote:{text:'x'}},{brandId:'bad'}]){
    const r=await f.call(changes);assert.notEqual(r.status,200);assert.equal(f.writes.length,0);
  }
});

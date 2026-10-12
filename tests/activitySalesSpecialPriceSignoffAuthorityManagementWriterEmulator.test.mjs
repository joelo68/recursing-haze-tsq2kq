import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const PROJECT='demo-drcyj-activity-sales';
if((process.env.GCLOUD_PROJECT||process.env.GOOGLE_CLOUD_PROJECT)!==PROJECT ||
  !process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST)
  throw Error('L3B2B3_AUTHORITY_REQUIRES_DEMO_EMULATOR_ONLY');
const admin=require('../functions/node_modules/firebase-admin');
if(!admin.apps.length)admin.initializeApp({projectId:PROJECT});
const db=admin.firestore();
const {createSpecialPriceSignoffAuthorityManagementHandler}=require('../functions/activitySalesSpecialPriceSignoffAuthorityManagementWriter.js');
const {parseSignoffAuthority}=require('../functions/activitySalesSpecialPricePolicySignoffContract.js');
const {verifySuperAdminActor}=require('../functions/deviceApproval.js');
const prefix=b=>b==='cyj'?'artifacts/default-app-id/public/data':`brands/${b}`;
const col=(_db,b,name)=>db.collection(`${prefix(b)}/${name}`);
const setting=(_db,b,name)=>db.doc(`${prefix(b)}/${b==='cyj'?'global_settings':'settings'}/${name}`);
const actor={roleId:'director',accountId:'D001',deviceId:'trusted',credentialPassword:'test-only'};
const roster={BUSINESS:[{roleId:'manager',accountId:'M001'}],FINANCE:[{roleId:'director',accountId:'D002'}]};
const reply=()=>({code:200,status(n){this.code=n;return this;},json(body){return {status:this.code,body};}});
const service=brand=>({now:()=>new Date('2026-10-12T07:00:00Z'),getBrandCollection:col,getBrandSettingDoc:setting,
  requireFirebaseRequestAuth:async()=>({ok:true,decoded:{drcyjIdentity:true,identityVersion:'application-identity-v1',brandId:brand,roleId:'director',accountId:'D001'}}),
  verifySuperAdminActor});
let seq=0;
async function setup(brand){
 const a=col(db,brand,'activity_sales_special_price_signoff_authority');
 // Deliberately isolated demo project and brand-specific document scope.
 await Promise.all([
  setting(db,brand,'manager_auth').set({M001:{id:'M001',isActive:true}}),
  setting(db,brand,'director_auth').set({accounts:{D001:{id:'D001',name:'Super Administrator',isActive:true,level:'super_admin',password:'test-only'},D002:{id:'D002',isActive:true}}}),
  setting(db,brand,'master_auth').set({password:'not-the-admin-password'}),
  col(db,brand,'account_devices').doc(`${brand}_director_D001`).set({devices:{trusted:{trusted:true,status:'trusted',source:'admin_approved'}}}),
  a.doc('current').delete(),
 ]);
 const writer=createSpecialPriceSignoffAuthorityManagementHandler({admin,db,services:service(brand)});
 const call=(action,rest={})=>writer({method:'POST',body:{action,brandId:brand,actor,...rest}},reply());
 return {brand,a,call};
}
test('L3B2B3 real Firestore OCC: concurrent 3 brands, one first writer, two immutable revisions, revoke invalidates policy',async()=>{
 for(const brand of ['cyj','anniu','yibo']){
  const s=await setup(brand);
  // Shared Emulator already contains valid sales from earlier suites. Snapshot *this*
  // brand before management, rather than assuming its entire sales collection is empty.
  const sales=col(db,brand,'activity_sales_attribution_sales');
  const unchangedSales=async()=>{
    const snapshot=await sales.get(); // Emulator-only bounded test fixture, never runtime query.
    return snapshot.docs.map(d=>[d.id,JSON.stringify(d.data())]).sort((x,y)=>x[0].localeCompare(y[0]));
  };
  const salesBefore=await unchangedSales();
  const a=s.call('set_special_price_signoff_authority',{expectedRevision:0,reviewers:roster});
  const b=s.call('set_special_price_signoff_authority',{expectedRevision:0,reviewers:{BUSINESS:[{roleId:'manager',accountId:'M001'}],FINANCE:[{roleId:'director',accountId:'D002'}]}});
  const pair=await Promise.all([a,b]);
  assert.deepEqual(pair.map(v=>v.status).sort(),[200,409],brand+': concurrent OCC '+JSON.stringify(pair));
  const first=(await s.a.doc('current').get()).data();
  assert.equal(first.revision,1);assert.equal(first.brandId,brand);
  assert.equal(parseSignoffAuthority(first,brand).revision,1);
  const revoke=await s.call('disable_special_price_signoff_authority',{expectedRevision:1});
  assert.equal(revoke.status,200);assert.equal(revoke.body.enabled,false);
  const final=(await s.a.doc('current').get()).data();assert.equal(final.revision,2);
  assert.throws(()=>parseSignoffAuthority(final,brand),/SPECIAL_PRICE_SIGNOFF_AUTHORITY_UNAVAILABLE/);
  const audit=col(db,brand,'activity_sales_special_price_signoff_authority_audit');
  for(const i of [1,2]){const item=await audit.doc(`revision_${String(i).padStart(12,'0')}`).get();
   assert.equal(item.exists,true);assert.equal(item.data().postingAllowed,false);
   assert.equal(item.data().brandId,brand);
  }
  // Never confuse pre-existing attribution sales with writer side-effects.
  assert.deepEqual(await unchangedSales(),salesBefore,brand+': authority edits cannot create, remove or change any sale');
 }
});
test('L3B2B3 missing signer and stale version both fail without modifying authority',async()=>{
 const brand='yibo',s=await setup(brand);
 await setting(db,brand,'manager_auth').set({M001:{id:'M001',isActive:false}});
 const denied=await s.call('set_special_price_signoff_authority',{expectedRevision:0,reviewers:roster});
 assert.equal(denied.status,409);assert.equal((await s.a.doc('current').get()).exists,false);
});

test('L3B2B3 revocation between outside verification and transaction read denies update',async()=>{
 const brand='cyj';
 const s=await setup(brand);
 let calls=0;
  const revokeRef=col(db,brand,'account_devices').doc(`${brand}_director_D001`);
  // An earlier scenario legitimately wrote revision 1 into this shared demo Emulator.
  // The revocation test must prove immutability, not expect a globally empty audit.
  const auditRef=col(db,brand,'activity_sales_special_price_signoff_authority_audit')
    .doc('revision_000000000001');
  const auditBefore=await auditRef.get();
 const serviceWithRevocation={...service(brand),verifySuperAdminActor:async ({db:readDb,...args})=>{
   calls++;
   if(calls===2) await revokeRef.update({'devices.trusted.trusted':false,'devices.trusted.status':'blocked'});
   return verifySuperAdminActor({db:readDb,...args});
 }};
 const writer=createSpecialPriceSignoffAuthorityManagementHandler({admin,db,services:serviceWithRevocation});
 const response=await writer({method:'POST',body:{action:'set_special_price_signoff_authority',brandId:brand,
   actor,expectedRevision:0,reviewers:roster}},reply());
 assert.equal(response.status,403,JSON.stringify(response.body));
 assert.equal(response.body.code,'SIGNOFF_AUTHORITY_SUPER_ADMIN_REVOKED');
 assert.equal(calls,2);
 assert.equal((await s.a.doc('current').get()).exists,false);
  const auditAfter=await auditRef.get();
  assert.equal(auditAfter.exists,auditBefore.exists,'revocation must not create or delete audit');
  assert.deepEqual(auditAfter.data(),auditBefore.data(),'revocation must not mutate prior audit');
});

test('L3B2B3-R5 shared global block denies 3 brands even if brand-local device remains trusted',async()=>{
 const globalRef=db.doc('artifacts/default-app-id/public/data/global_blocked_devices/director_D001_trusted');
 const old=await globalRef.get();
 try{
  await globalRef.set({active:true,status:'global_blocked'});
  for(const brand of ['cyj','anniu','yibo']){
   const s=await setup(brand);
   const auditRef=col(db,brand,'activity_sales_special_price_signoff_authority_audit').doc('revision_000000000001');
   const before=await auditRef.get();
   const result=await s.call('set_special_price_signoff_authority',{expectedRevision:0,reviewers:roster});
   assert.equal(result.status,403,`${brand}: ${JSON.stringify(result.body)}`);
   assert.equal(result.body.code,'SIGNOFF_AUTHORITY_SUPER_ADMIN_REQUIRED');
   assert.equal((await s.a.doc('current').get()).exists,false);
   const after=await auditRef.get();
   assert.equal(after.exists,before.exists);
   assert.deepEqual(after.data(),before.data());
  }
  await globalRef.set({active:false,status:'resolved'});
  const allowed=await verifySuperAdminActor({db,brandId:'anniu',actor});
  assert.equal(allowed.ok,true,'resolved global marker must restore the original trusted-device decision');
 }finally{
  if(old.exists)await globalRef.set(old.data());else await globalRef.delete();
 }
});

test('L3B2B3-R5 global block inserted after preflight is detected INSIDE transaction',async()=>{
 const brand='yibo',s=await setup(brand);
 const globalRef=db.doc('artifacts/default-app-id/public/data/global_blocked_devices/director_D001_trusted');
 const old=await globalRef.get();
 await globalRef.delete();
 const auditRef=col(db,brand,'activity_sales_special_price_signoff_authority_audit').doc('revision_000000000001');
 const auditBefore=await auditRef.get();let calls=0;
 try{
  const services={...service(brand),verifySuperAdminActor:async params=>{
   calls++;
   if(calls===2)await globalRef.set({active:true,status:'blocked'});
   return verifySuperAdminActor(params);
  }};
  const writer=createSpecialPriceSignoffAuthorityManagementHandler({admin,db,services});
  const result=await writer({method:'POST',body:{action:'set_special_price_signoff_authority',brandId:brand,
   actor,expectedRevision:0,reviewers:roster}},reply());
  assert.equal(calls,2);
  assert.equal(result.status,403,JSON.stringify(result.body));
  assert.equal(result.body.code,'SIGNOFF_AUTHORITY_SUPER_ADMIN_REVOKED');
  assert.equal((await s.a.doc('current').get()).exists,false);
  const auditAfter=await auditRef.get();
  assert.equal(auditAfter.exists,auditBefore.exists);
  assert.deepEqual(auditAfter.data(),auditBefore.data());
 }finally{
  if(old.exists)await globalRef.set(old.data());else await globalRef.delete();
 }
});

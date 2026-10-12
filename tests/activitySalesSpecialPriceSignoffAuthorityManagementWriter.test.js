import {createRequire} from 'node:module';
import test from 'node:test';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {createSpecialPriceSignoffAuthorityManagementHandler}=require('../functions/activitySalesSpecialPriceSignoffAuthorityManagementWriter');
const actor={roleId:'director',accountId:'D001',deviceId:'dev',credentialPassword:'secret'};
const roster={BUSINESS:[{roleId:'manager',accountId:'M001'}],FINANCE:[{roleId:'director',accountId:'D002'}]};
const response=()=>({code:200,status(n){this.code=n;return this;},json(body){return {status:this.code,body};}});
function fixture(brandId='cyj',overrides={}){
 const store=new Map(),history=[],base=brandId==='cyj'?'artifacts/default-app-id/public/data':`brands/${brandId}`;
 const ref=path=>({path,id:path.split('/').pop(),get:async()=>{const raw=store.get(path);return {exists:raw!==undefined,data:()=>raw};}});
 const col=(_db,b,name)=>({doc:id=>ref(`${b==='cyj'?'artifacts/default-app-id/public/data':`brands/${b}`}/${name}/${id}`)});
 const setting=(_db,b,name)=>ref(`${b==='cyj'?'artifacts/default-app-id/public/data':`brands/${b}`}/${b==='cyj'?'global_settings':'settings'}/${name}`);
 const auth=(_brand=brandId)=>({ok:true,decoded:{drcyjIdentity:true,identityVersion:'application-identity-v1',brandId:_brand,roleId:'director',accountId:'D001'}});
 store.set(`${base}/${brandId==='cyj'?'global_settings':'settings'}/manager_auth`,{M001:{id:'M001',isActive:true}});
 store.set(`${base}/${brandId==='cyj'?'global_settings':'settings'}/director_auth`,{accounts:{D002:{id:'D002',isActive:true}}});
 const db={runTransaction:async callback=>{
   const reads=[],writes=[];
   const tx={get:async r=>{reads.push(r.path);return r.get()},create:(r,d)=>writes.push({method:'create',path:r.path,data:d}),set:(r,d)=>writes.push({method:'set',path:r.path,data:d})};
   const result=await callback(tx);
   const firstWrite=writes.findIndex(()=>true);if(firstWrite>=0){
    for(const w of writes){if(w.method==='create' && store.has(w.path))throw Object.assign(new Error('already_exists'),{code:'ALREADY_EXISTS'});store.set(w.path,w.data);}
   }
   history.push({reads,writes});return result;
 }};
 const services={getBrandCollection:col,getBrandSettingDoc:setting,now:()=>new Date('2026-10-12T06:00:00.000Z'),
   requireFirebaseRequestAuth:async()=>overrides.auth??auth(),
   verifySuperAdminActor:async(input)=>overrides.verifySuperAdminActor?overrides.verifySuperAdminActor(input):
     (overrides.adminCheck??{ok:true,actorRole:'director',actorAccountId:'D001',isMasterCredential:false})};
 const handler=createSpecialPriceSignoffAuthorityManagementHandler({admin:{firestore:{FieldValue:{serverTimestamp:()=>({stamp:true})}}},db,services});
 const call=(action,rest={})=>handler({method:'POST',body:{action,brandId,actor,...rest}},response());
 return {call,store,history,base};
}
for(const brand of ['cyj','anniu','yibo']){
 test(`${brand}: get->set->OCC reject->disable->read, audit append-only and scope`,async()=>{
  const f=fixture(brand),initial=await f.call('get_special_price_signoff_authority');
  assert.equal(initial.status,200);assert.equal(initial.body.revision,0);
  const created=await f.call('set_special_price_signoff_authority',{expectedRevision:0,reviewers:roster});
  assert.equal(created.status,200,JSON.stringify(created.body));assert.equal(created.body.revision,1);
  assert.equal(created.body.postingAllowed,false);
  const bad=await f.call('set_special_price_signoff_authority',{expectedRevision:0,reviewers:roster});
  assert.equal(bad.status,409);assert.equal(bad.body.code,'SIGNOFF_AUTHORITY_REVISION_CONFLICT');
  const off=await f.call('disable_special_price_signoff_authority',{expectedRevision:1});
  assert.equal(off.status,200);assert.equal(off.body.enabled,false);
  const after=await f.call('get_special_price_signoff_authority');assert.equal(after.body.revision,2);
  assert.equal(f.store.get(`${f.base}/activity_sales_special_price_signoff_authority/current`).enabled,false);
  assert.equal(f.store.has(`${f.base}/activity_sales_special_price_signoff_authority_audit/revision_000000000001`),true);
  assert.equal(f.store.has(`${f.base}/activity_sales_special_price_signoff_authority_audit/revision_000000000002`),true);
  assert.equal(f.history[0].writes.length,2);assert.equal(f.history[1].writes.length,2);
  assert.equal(f.history.every(h=>h.writes.every(w=>w.path.startsWith(f.base+'/'))),true);
 });
}
test('session brand mismatch cannot fetch or update private roster',async()=>{
 const f=fixture('cyj',{auth:{ok:true,decoded:{drcyjIdentity:true,identityVersion:'application-identity-v1',brandId:'anniu',roleId:'director',accountId:'D001'}}});
 assert.equal((await f.call('get_special_price_signoff_authority')).status,403);
 assert.equal((await f.call('set_special_price_signoff_authority',{expectedRevision:0,reviewers:roster})).status,403);
 assert.equal(f.history.length,0);
});
test('superadmin adminCheck and master credentials cannot update',async()=>{
 for(const adminCheck of [{ok:false},{ok:true,actorRole:'master',actorAccountId:'D001',isMasterCredential:true},{ok:true,actorRole:'director',actorAccountId:'D002',isMasterCredential:false}]){
  const f=fixture('cyj',{adminCheck});assert.equal((await f.call('set_special_price_signoff_authority',{expectedRevision:0,reviewers:roster})).status,403);
  assert.equal(f.history.length,0);
 }
});
test('inactive named reviewer cannot be granted, no writes',async()=>{
 const f=fixture();f.store.set(`${f.base}/global_settings/manager_auth`,{M001:{isActive:false}});
 const res=await f.call('set_special_price_signoff_authority',{expectedRevision:0,reviewers:roster});
 assert.equal(res.status,409);assert.equal(res.body.code,'SIGNOFF_AUTHORITY_REVIEWER_INACTIVE');
 assert.equal(f.history.length,0);assert.equal(f.store.has(`${f.base}/activity_sales_special_price_signoff_authority/current`),false);
});
test('malformed current authority cannot be silently overwritten',async()=>{
 const f=fixture();f.store.set(`${f.base}/activity_sales_special_price_signoff_authority/current`,{enabled:true,revision:123});
 const res=await f.call('disable_special_price_signoff_authority',{expectedRevision:123});
 assert.equal(res.status,409);assert.equal(res.body.code,'SIGNOFF_AUTHORITY_STORED_CORRUPT');
});

test('transaction rechecks super-admin authority; revoked AFTER outer authentication means no writes',async()=>{
 let n=0;
 const f=fixture('cyj',{verifySuperAdminActor:async()=>{
   n++;return n===1?{ok:true,actorRole:'director',actorAccountId:'D001',isMasterCredential:false}:{ok:false};
 }});
 const denied=await f.call('set_special_price_signoff_authority',{expectedRevision:0,reviewers:roster});
 assert.equal(denied.status,403);assert.equal(denied.body.code,'SIGNOFF_AUTHORITY_SUPER_ADMIN_REVOKED');
 assert.equal(n,2);assert.equal(f.history.length,0);
 assert.equal(f.store.has(`${f.base}/activity_sales_special_price_signoff_authority/current`),false);
});
test('transactionReadView wraps exact refs as transactional reads without allowing writes',async()=>{
 const {transactionReadView}=require('../functions/activitySalesSpecialPriceSignoffAuthorityManagementWriter');
 const read=[];const ref=path=>({path,doc:id=>ref(`${path}/${id}`),collection:name=>ref(`${path}/${name}`)});
 const db={doc:ref,collection:ref},tx={get:async r=>{read.push(r.path);return {exists:false};}};
 const view=transactionReadView(db,tx);
 await view.doc('brands/anniu/settings/director_auth').get();
 await view.collection('brands').doc('yibo').collection('account_devices').doc('yibo_director_D001').get();
 assert.deepEqual(read,['brands/anniu/settings/director_auth','brands/yibo/account_devices/yibo_director_D001']);
 assert.equal(typeof view.doc('x').set,'undefined');
});

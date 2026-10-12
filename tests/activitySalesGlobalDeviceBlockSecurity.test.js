import {createRequire} from 'node:module';
import test from 'node:test';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {verifySuperAdminActor}=require('../functions/deviceApproval.js');

const creds={roleId:'director',accountId:'D001',deviceId:'dev-global',credentialPassword:'test-only'};
const GLOBAL='artifacts/default-app-id/public/data/global_blocked_devices/director_D001_dev-global';
function pathFor(b,type){const root=b==='cyj'?'artifacts/default-app-id/public/data':`brands/${b}`;
 return `${root}/${type==='devices'?'account_devices':b==='cyj'?'global_settings':'settings'}`;}
function mock(brand){
 const docs=new Map(),reads=[];
 const ref=path=>({path,doc:id=>ref(`${path}/${id}`),collection:id=>ref(`${path}/${id}`),
   get:async()=>{reads.push(path);const data=docs.get(path);return {exists:data!==undefined,data:()=>data};}});
 const db={doc:ref,collection:ref};
 docs.set(`${pathFor(brand,'devices')}/${brand}_director_D001`,{devices:{'dev-global':{trusted:true,status:'trusted',source:'admin_approved'}}});
 docs.set(`${pathFor(brand,'settings')}/director_auth`,{accounts:{D001:{id:'D001',name:'Dir',level:'super_admin',password:'test-only',isActive:true}}});
 docs.set(`${pathFor(brand,'settings')}/master_auth`,{password:'not-test-only'});
 return {db,docs,reads};
}
for(const brand of ['cyj','anniu','yibo']){
 test(`${brand}: global block denies super admin despite brand-local trusted device`,async()=>{
   const f=mock(brand);
   assert.equal((await verifySuperAdminActor({db:f.db,brandId:brand,actor:creds})).ok,true);
   assert.ok(f.reads.includes(GLOBAL),'shared global marker must be point-read');
   f.docs.set(GLOBAL,{active:true,status:'global_blocked'});
   assert.equal((await verifySuperAdminActor({db:f.db,brandId:brand,actor:creds})).ok,false);
   f.docs.set(GLOBAL,{active:true,status:'blocked'});
   assert.equal((await verifySuperAdminActor({db:f.db,brandId:brand,actor:creds})).ok,false);
   f.docs.set(GLOBAL,{active:false,status:'blocked'});
   assert.equal((await verifySuperAdminActor({db:f.db,brandId:brand,actor:creds})).ok,true,
     'resolved/disabled marker must not trap legitimate director');
   f.docs.set(GLOBAL,{active:true,status:'observing'});
   assert.equal((await verifySuperAdminActor({db:f.db,brandId:brand,actor:creds})).ok,true,
     'must match upstream login semantics, not invent new states');
 });
}
test('global device marker key is shared across brands but each credential/profile is brand private',async()=>{
 const cyj=mock('cyj'),anniu=mock('anniu');
 anniu.docs.set(GLOBAL,{active:true,status:'global_blocked'});
 assert.equal((await verifySuperAdminActor({db:anniu.db,brandId:'anniu',actor:creds})).ok,false);
 assert.ok(anniu.reads.some(p=>p.startsWith('brands/anniu/account_devices/')));
 assert.equal(anniu.reads.some(p=>p.startsWith('artifacts/default-app-id/public/data/account_devices/')),false);
 assert.equal((await verifySuperAdminActor({db:cyj.db,brandId:'cyj',actor:creds})).ok,true,
   'mock DBs isolated; this unit only asserts path semantics; emulator covers shared persistence');
});

import {createRequire} from 'node:module';
import test from 'node:test';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {checkedAuthorityBody,buildNextAuthority,inspectStored}=require('../functions/activitySalesSpecialPriceSignoffAuthorityManagementContract');
const who={roleId:'director',accountId:'D001',deviceId:'trusted',credentialPassword:'test-only'};
const reviewers={BUSINESS:[{roleId:'manager',accountId:'M001'}],FINANCE:[{roleId:'director',accountId:'D002'}]};
const input=(brandId='cyj',expectedRevision=0)=>({action:'set_special_price_signoff_authority',brandId,expectedRevision,reviewers,actor:who});
const err=(fn,code)=>assert.throws(fn,e=>e.code===code);
for(const brand of ['cyj','anniu','yibo']){
 test(`${brand} brand-private first set and explicit disable; revocation invalidates active contract`,()=>{
  assert.deepEqual(checkedAuthorityBody(input(brand)).set,true);
  const first=buildNextAuthority({brandId:brand,expectedRevision:0,enabled:true,reviewers});
  assert.equal(first.next.revision,1);assert.equal(first.next.brandId,brand);assert.equal(first.next.enabled,true);
  assert.match(first.authorityHash,/^[a-f0-9]{64}$/);
  assert.equal(first.next.postingAllowed,undefined);
  const disabled=buildNextAuthority({brandId:brand,expectedRevision:1,stored:first.next,enabled:false});
  assert.equal(disabled.next.enabled,false);assert.equal(disabled.next.revision,2);
  assert.equal(disabled.authorityHash,null);assert.deepEqual(disabled.next.reviewers,{BUSINESS:[],FINANCE:[]});
  assert.equal(inspectStored(disabled.next,brand),disabled.next);
  const restored=buildNextAuthority({brandId:brand,expectedRevision:2,stored:disabled.next,enabled:true,reviewers});
  assert.equal(restored.next.revision,3);assert.notEqual(restored.authorityHash,first.authorityHash);
 });
}
test('reject same brand stale expected revision, tampered prior, brand mix and no-op',()=>{
 const a=buildNextAuthority({brandId:'cyj',expectedRevision:0,enabled:true,reviewers}).next;
 err(()=>buildNextAuthority({brandId:'cyj',expectedRevision:0,enabled:false,stored:a}),'SIGNOFF_AUTHORITY_REVISION_CONFLICT');
 err(()=>buildNextAuthority({brandId:'anniu',expectedRevision:1,enabled:false,stored:a}),'SIGNOFF_AUTHORITY_STORED_CORRUPT');
 err(()=>buildNextAuthority({brandId:'cyj',expectedRevision:1,enabled:true,stored:a,reviewers}),'SIGNOFF_AUTHORITY_UNCHANGED');
 err(()=>buildNextAuthority({brandId:'cyj',expectedRevision:1,enabled:false,stored:{...a,unexpected:true}}),'SIGNOFF_AUTHORITY_STORED_CORRUPT');
});
test('missing active reviewers and account reused across stages both fail closed',()=>{
 err(()=>buildNextAuthority({brandId:'cyj',expectedRevision:0,enabled:true,reviewers:{BUSINESS:[],FINANCE:reviewers.FINANCE}}),'SPECIAL_PRICE_SIGNOFF_REVIEWERS_INVALID');
 err(()=>buildNextAuthority({brandId:'cyj',expectedRevision:0,enabled:true,reviewers:{BUSINESS:reviewers.BUSINESS,FINANCE:reviewers.BUSINESS}}),'SPECIAL_PRICE_SIGNOFF_DUPLICATE_REVIEWER');
});
test('reject unsupported role, invalid account and extra fields',()=>{
 err(()=>buildNextAuthority({brandId:'cyj',expectedRevision:0,enabled:true,reviewers:{BUSINESS:[{roleId:'master',accountId:'X'}],FINANCE:reviewers.FINANCE}}),'SPECIAL_PRICE_SIGNOFF_ACTOR_INVALID');
 err(()=>checkedAuthorityBody({...input(),isSuperAdmin:true}),'SIGNOFF_AUTHORITY_INPUT_INVALID');
 err(()=>checkedAuthorityBody({...input(),expectedRevision:'0'}),'SIGNOFF_AUTHORITY_INPUT_INVALID');
 err(()=>checkedAuthorityBody({...input(),brandId:'default'}),'SIGNOFF_AUTHORITY_INPUT_INVALID');
 err(()=>checkedAuthorityBody({...input(),actor:{...who,roleId:'manager'}}),'SIGNOFF_AUTHORITY_INPUT_INVALID');
});
test('get is separate read-only action; disabled action rejects reviewer payload',()=>{
 const get=checkedAuthorityBody({action:'get_special_price_signoff_authority',brandId:'cyj',actor:who});
 assert.equal(get.get,true);
 err(()=>checkedAuthorityBody({action:'get_special_price_signoff_authority',brandId:'cyj',actor:who,expectedRevision:0}),'SIGNOFF_AUTHORITY_INPUT_INVALID');
 err(()=>checkedAuthorityBody({action:'disable_special_price_signoff_authority',brandId:'cyj',actor:who,expectedRevision:1,reviewers}),'SIGNOFF_AUTHORITY_INPUT_INVALID');
});
test('disabled policy cannot be considered active',()=>{
 const first=buildNextAuthority({brandId:'cyj',expectedRevision:0,enabled:true,reviewers}).next;
 const disabled=buildNextAuthority({brandId:'cyj',expectedRevision:1,enabled:false,stored:first}).next;
 err(()=>buildNextAuthority({brandId:'cyj',expectedRevision:2,enabled:false,stored:disabled}),'SIGNOFF_AUTHORITY_UNCHANGED');
 err(()=>inspectStored({...disabled,reviewers},'cyj'),'SIGNOFF_AUTHORITY_DISABLED_CORRUPT');
});

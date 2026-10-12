import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {SCHEMA,activeGlobalBlock,acceptsLegacyTrust,auditOfflineSnapshot}=require('../functions/activitySalesL3B2B4ReadinessAudit.js');
const empty=()=>({schemaVersion:SCHEMA,profiles:[]});
const profile=(brandId='cyj', devices={},globalMarkers={})=>({brandId,roleId:'director',accountId:'DEMO_ACCOUNT',devices,globalMarkers});
const full=()=>({schemaVersion:SCHEMA,profiles:[profile('cyj'),profile('anniu'),profile('yibo')]});
const codes=x=>x.findings.map(f=>f.code);

test('global block follows current upstream status or source fallback semantics',()=>{
 assert.equal(activeGlobalBlock({active:true,status:'global_blocked'}),true);
 assert.equal(activeGlobalBlock({active:false,status:'global_blocked'}),false);
 assert.equal(activeGlobalBlock({source:'manual_global_blocked'}),true);
 assert.equal(activeGlobalBlock({status:'resolved',source:'manual_global_blocked'}),false);
 assert.equal(activeGlobalBlock(null),false);
});
test('legacy trust mirrors current upstream trusted !== false status/source semantics',()=>{
 assert.equal(acceptsLegacyTrust({status:'trusted'}),true);
 assert.equal(acceptsLegacyTrust({status:'trusted',trusted:false}),false);
 assert.equal(acceptsLegacyTrust({status:'new'}),false);
 assert.equal(acceptsLegacyTrust({source:'manual_global_blocked'}),false);
});
test('never returns any financial or deploy authority even for 3 complete empty brands',()=>{
 const output=auditOfflineSnapshot(full());
 assert.equal(output.status,'HOLD_NO_POSTING');
 assert.equal(output.inputAuthority,'UNAUTHENTICATED_OFFLINE_SNAPSHOT');
 assert.deepEqual(output.brandCoverage.missing,[]);
 assert.equal(output.permissions.canPost,false);
 assert.equal(output.permissions.canDeploy,false);
 assert.equal(output.permissions.canGrantAuthority,false);
 assert.equal(output.permissions.formalRevenueDelta,0);
 assert.equal(output.requiredGates.length,5);
});
test('missing brand coverage is explicitly reported',()=>{
 assert.deepEqual(auditOfflineSnapshot(empty()).brandCoverage.missing,['cyj','anniu','yibo']);
 assert.throws(()=>auditOfflineSnapshot({schemaVersion:SCHEMA,profiles:[profile('yjNotAllowed')]}),/L3B2B4_SNAPSHOT_INVALID/);
});
test('missing legacy trusted is counted only when legacy behavior accepts',()=>{
 const d={A:{status:'trusted'},B:{trusted:true,status:'trusted'},C:{trusted:false,status:'trusted'},D:{status:'blocked'}};
 const x=auditOfflineSnapshot({schemaVersion:SCHEMA,profiles:[profile('cyj',d,{A:null,B:null,C:null,D:null})]});
 assert.equal(x.counts.legacyImplicitTrust,1);
 assert.equal(x.counts.devices,4);
 assert(codes(x).includes('LEGACY_IMPLICIT_TRUST'));
});
test('explicit zero marker absence is distinct from missing global marker evidence',()=>{
 const snap={schemaVersion:SCHEMA,profiles:[profile('cyj',{A:{trusted:true}},{A:null})]};
 assert.equal(auditOfflineSnapshot(snap).counts.unreadGlobalMarkers,0);
 delete snap.profiles[0].globalMarkers.A;
 assert.equal(auditOfflineSnapshot(snap).counts.unreadGlobalMarkers,1);
});
test('a trusted id with global block is highlighted but no auto-banning action occurs',()=>{
 const x=auditOfflineSnapshot({schemaVersion:SCHEMA,profiles:[profile('anniu',{a:{trusted:true,status:'trusted'}},{a:{active:true,status:'global_blocked'}})]});
 assert.equal(x.counts.activeGlobalBlockConflicts,1);
 assert(codes(x).includes('TRUSTED_DEVICE_HAS_GLOBAL_BLOCK'));
 assert.equal(x.permissions.canDeploy,false);
});
test('inactive marker does not count as active global block',()=>{
 const x=auditOfflineSnapshot({schemaVersion:SCHEMA,profiles:[profile('cyj',{a:{trusted:true,status:'trusted'}},{a:{active:false,status:'global_blocked'}})]});
 assert.equal(x.counts.activeGlobalBlockConflicts,0);
});
test('same-account fingerprint aliases and block conflict are detected without exposing fingerprint',()=>{
 const secret='PRIVATE_FP_MUST_NOT_LEAK';
 const p=profile('yibo',{a:{trusted:true,deviceFingerprint:secret},b:{trusted:true,deviceFingerprint:secret}},
  {a:{active:true,status:'global_blocked'},b:null});
 const x=auditOfflineSnapshot({schemaVersion:SCHEMA,profiles:[p]});
 assert.equal(x.counts.fingerprintAliases,1);
 assert.equal(x.counts.blockedAliasConflicts,1);
 assert.equal(x.counts.activeGlobalBlockConflicts,1);
 assert(!JSON.stringify(x).includes(secret));
 assert(!JSON.stringify(x).includes('DEMO_ACCOUNT'));
 assert(!JSON.stringify(x).includes('"deviceId"'));
});
test('alias does not cross account/brand boundary',()=>{
 const data=full();
 data.profiles[0].devices={a:{trusted:true,deviceFingerprint:'shared'}};
 data.profiles[0].globalMarkers={a:{status:'global_blocked'}};
 data.profiles[1].devices={b:{trusted:true,deviceFingerprint:'shared'}};
 data.profiles[1].globalMarkers={b:null};
 assert.equal(auditOfflineSnapshot(data).counts.blockedAliasConflicts,0);
 assert.equal(auditOfflineSnapshot(data).counts.fingerprintAliases,0);
});
test('status overrides source like upstream and contradictory marker is flagged for review',()=>{
 const x=auditOfflineSnapshot({schemaVersion:SCHEMA,profiles:[profile('cyj',{a:{trusted:true}},
  {a:{active:true,status:'resolved',source:'manual_global_blocked'}})]});
 assert.equal(x.counts.activeGlobalBlockConflicts,0);
 assert.equal(x.counts.ambiguousGlobalBlockRecords,1);
 assert(codes(x).includes('GLOBAL_BLOCK_STATUS_SOURCE_AMBIGUOUS'));
});
test('rejects duplicate exact brand+role+account profiles',()=>{
 assert.throws(()=>auditOfflineSnapshot({schemaVersion:SCHEMA,profiles:[profile('cyj'),profile('cyj')]}),/L3B2B4_SNAPSHOT_INVALID/);
});
test('rejects unknown or normalized brand aliases rather than silently mapping to cyj',()=>{
 assert.throws(()=>auditOfflineSnapshot({schemaVersion:SCHEMA,profiles:[profile('default-app-id')]}),/L3B2B4_SNAPSHOT_INVALID/);
});
test('rejects inconsistent profile or marker scopes',()=>{
 const p=profile('cyj',{A:{trusted:true}},{A:null,B:null});
 assert.throws(()=>auditOfflineSnapshot({schemaVersion:SCHEMA,profiles:[p]}),/L3B2B4_SNAPSHOT_INVALID/);
});
test('rejects unrecognized sensitive device data to avoid reading secrets and accidental output',()=>{
 const p=profile('cyj',{A:{trusted:true,credentialPassword:'DO_NOT_TOUCH'}},{A:null});
 assert.throws(()=>auditOfflineSnapshot({schemaVersion:SCHEMA,profiles:[p]}),/L3B2B4_SNAPSHOT_INVALID/);
});
test('rejects unsafe Firestore id characters and role',()=>{
 const p=profile('cyj',{A:{trusted:true}},{A:null});p.accountId='wrong/path';
 assert.throws(()=>auditOfflineSnapshot({schemaVersion:SCHEMA,profiles:[p]}),/L3B2B4_SNAPSHOT_INVALID/);
 p.accountId='S001';p.roleId='financialSuper';
 assert.throws(()=>auditOfflineSnapshot({schemaVersion:SCHEMA,profiles:[p]}),/L3B2B4_SNAPSHOT_INVALID/);
});
test('enforces profile and device-count bounds without scanning collections',()=>{
 const tooMany={schemaVersion:SCHEMA,profiles:Array.from({length:121},(_,i)=>profile('cyj',{},{}))};
 assert.throws(()=>auditOfflineSnapshot(tooMany),/L3B2B4_SNAPSHOT_INVALID/);
 const devices=Object.fromEntries(Array.from({length:101},(_,i)=>['d'+i,{trusted:true}]));
 assert.throws(()=>auditOfflineSnapshot({schemaVersion:SCHEMA,profiles:[profile('cyj',devices,{})]}),/L3B2B4_SNAPSHOT_INVALID/);
});
test('rejects invalid marker fields and arbitrary root keys',()=>{
 const p=profile('cyj',{A:{trusted:true}},{A:{active:'true',status:'global_blocked'}});
 assert.throws(()=>auditOfflineSnapshot({schemaVersion:SCHEMA,profiles:[p]}),/L3B2B4_SNAPSHOT_INVALID/);
 const x=empty();x.postingAllowed=true;
 assert.throws(()=>auditOfflineSnapshot(x),/L3B2B4_SNAPSHOT_INVALID/);
});
test('rejects attempted approval injection in input',()=>{
 const x=full();x.profiles[0].authorityApproved=true;
 assert.throws(()=>auditOfflineSnapshot(x),/L3B2B4_SNAPSHOT_INVALID/);
});
test('snapshot and output do not mutate caller-provided source',()=>{
 const x=full(),before=JSON.stringify(x);auditOfflineSnapshot(x);assert.equal(JSON.stringify(x),before);
});

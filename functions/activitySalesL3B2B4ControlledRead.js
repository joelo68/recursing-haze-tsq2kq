"use strict";
// L3B2B4B: bounded, read-only operator-controlled evidence collection.
// NOT a production security authority, NOT a deployment/settlement approval.
const {auditOfflineSnapshot, SCHEMA: SNAPSHOT_SCHEMA}=require('./activitySalesL3B2B4ReadinessAudit.js');
const BRANDS=Object.freeze(['cyj','anniu','yibo']);
const ROLES=new Set(['director','manager','trainer','store','therapist']);
const SCOPE_SCHEMA='activity-sales-l3b2b4b-controlled-scope-v1';
const MAX_PER_BRAND=2,MAX_PROFILES=6,MAX_DEVICES_PER_PROFILE=15;
const MAX_ESTIMATED_READS=MAX_PROFILES*(MAX_DEVICES_PER_PROFILE+1);
const DISALLOWED=/[\/.#$\[\]\s]/g;
function abort(code){const e=new Error(code);e.code=code;throw e;}
function plain(x){return x!==null&&typeof x==='object'&&!Array.isArray(x)&&(Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null);}
function sanitize(value){return String(value||'').trim().replace(DISALLOWED,'_').slice(0,160)||'unknown';}
function profilePath(brand,role,account){
 const key=sanitize(`${brand}_${role}_${sanitize(account)}`);
 return (brand==='cyj'?'artifacts/default-app-id/public/data':`brands/${brand}`)+`/account_devices/${key}`;
}
function globalMarkerPath(role,account,device){
 const key=sanitize(`${role}_${account}_${device}`);
 return `artifacts/default-app-id/public/data/global_blocked_devices/${key}`;
}
function safeAccount(value){return typeof value==='string'&&value.length>0&&value.length<=100&&value===value.trim()&&!/[\x00-\x1f\x7f]/.test(value)&&value!=='unknown';}
function checkScope(input){
 if(!plain(input)||input.schemaVersion!==SCOPE_SCHEMA||!Array.isArray(input.profiles)||input.profiles.length<3||input.profiles.length>MAX_PROFILES||Object.keys(input).some(k=>!['schemaVersion','profiles'].includes(k)))abort('L3B2B4B_SCOPE_INVALID');
 const seen=new Set(),byBrand=Object.fromEntries(BRANDS.map(b=>[b,0])),selected=[];
 for(const row of input.profiles){
  if(!plain(row)||Object.keys(row).some(k=>!['brandId','roleId','accountId'].includes(k))||!BRANDS.includes(row.brandId)||!ROLES.has(row.roleId)||!safeAccount(row.accountId))abort('L3B2B4B_SCOPE_INVALID');
  const path=profilePath(row.brandId,row.roleId,row.accountId);
  if(seen.has(path))abort('L3B2B4B_SCOPE_DUPLICATE');
  seen.add(path);byBrand[row.brandId]++;
  if(byBrand[row.brandId]>MAX_PER_BRAND)abort('L3B2B4B_BRAND_LIMIT');
  selected.push({brandId:row.brandId,roleId:row.roleId,accountId:row.accountId,path});
 }
 if(BRANDS.some(brand=>byBrand[brand]===0))abort('L3B2B4B_THREE_BRANDS_REQUIRED');
 return {selected,byBrand,profileCount:selected.length,estimatedReadCeiling:MAX_ESTIMATED_READS};
}
function field(x,k){if(!Object.prototype.hasOwnProperty.call(x,k))return undefined;return x[k];}
function safeDevice(raw){
 if(!plain(raw))abort('L3B2B4B_DEVICE_SCHEMA_UNSUPPORTED');
 const d={};
 for(const key of ['trusted','status','source','deviceFingerprint']){
  const value=field(raw,key);
  if(value===undefined)continue;
  if(key==='trusted'&&typeof value!=='boolean')abort('L3B2B4B_DEVICE_SCHEMA_UNSUPPORTED');
  if(key!=='trusted'&&(typeof value!=='string'||value.length>256))abort('L3B2B4B_DEVICE_SCHEMA_UNSUPPORTED');
  d[key]=value;
 }
 return d;
}
function safeMarker(raw){
 if(!plain(raw))abort('L3B2B4B_MARKER_SCHEMA_UNSUPPORTED');
 const m={};
 for(const key of ['active','status','source']){
  const value=field(raw,key);
  if(value===undefined)continue;
  if(key==='active'&&typeof value!=='boolean')abort('L3B2B4B_MARKER_SCHEMA_UNSUPPORTED');
  if(key!=='active'&&(typeof value!=='string'||value.length>120))abort('L3B2B4B_MARKER_SCHEMA_UNSUPPORTED');
  m[key]=value;
 }
 return m;
}
async function collectScopedEvidence(db,input){
 // Caller injects an accessor restricted to doc(path).get() only; no query/listeners/writes.
 const scope=checkScope(input),snapshots=[];
 let requestedReads=0,missingProfiles=0,deviceCount=0;
 for(const p of scope.selected){
  requestedReads++;
  const snap=await db.doc(p.path).get();
  if(!snap.exists){missingProfiles++;snapshots.push({brandId:p.brandId,roleId:p.roleId,accountId:p.accountId,devices:{},globalMarkers:{}});continue;}
  const data=snap.data();
  if(!plain(data)||!plain(data.devices))abort('L3B2B4B_DEVICE_SCHEMA_UNSUPPORTED');
  // An exact account-key mismatch must not silently label a foreign account trusted.
  if(data.accountId!==undefined&&String(data.accountId)!==p.accountId)abort('L3B2B4B_PROFILE_IDENTITY_MISMATCH');
  if(data.role!==undefined&&String(data.role)!==p.roleId)abort('L3B2B4B_PROFILE_IDENTITY_MISMATCH');
  const ids=Object.keys(data.devices);
  if(ids.length>MAX_DEVICES_PER_PROFILE)abort('L3B2B4B_DEVICE_LIMIT_EXCEEDED');
  const devices={},globalMarkers={},seenMarkerPaths=new Set();
  for(const id of ids){
   if(typeof id!=='string'||!id||id.length>160||/[\x00-\x1f\x7f]/.test(id))abort('L3B2B4B_DEVICE_ID_INVALID');
   const markerPath=globalMarkerPath(p.roleId,p.accountId,id);
   if(seenMarkerPaths.has(markerPath))abort('L3B2B4B_MARKER_KEY_COLLISION');
   seenMarkerPaths.add(markerPath);
   devices[id]=safeDevice(data.devices[id]);
  }
  for(const id of ids){
   requestedReads++;
   const marker=await db.doc(globalMarkerPath(p.roleId,p.accountId,id)).get();
   globalMarkers[id]=marker.exists?safeMarker(marker.data()):null;
  }
  deviceCount+=ids.length;
  snapshots.push({brandId:p.brandId,roleId:p.roleId,accountId:p.accountId,devices,globalMarkers});
 }
 const offline=auditOfflineSnapshot({schemaVersion:SNAPSHOT_SCHEMA,profiles:snapshots});
 // Explicitly omit offline.findings (per-profile rows), original IDs and fingerprints.
 return Object.freeze({schemaVersion:'activity-sales-l3b2b4b-controlled-audit-report-v1',status:'HOLD_NO_POSTING',
   collectionMode:'OPERATOR_CONTROLLED_EXACT_DOC_READS',consistency:'NON_ATOMIC_READ_WINDOW',
   confidentiality:'COUNTS_ONLY_NO_IDENTIFIERS',brandCoverage:{selected:scope.byBrand,missing:offline.brandCoverage.missing},
   sample:{selectedProfiles:scope.profileCount,missingProfiles,devices:deviceCount,requestedReads,
    conservativeReadCeiling:scope.estimatedReadCeiling,billableReadsMayDiffer:true},
   riskCounts:offline.counts,
   requiredGates:[...offline.requiredGates,'SAMPLE_ONLY_NOT_FULL_INVENTORY',
    'DELETED_FINGERPRINT_ALIASES_NOT_OBSERVABLE','OPERATOR_APPROVED_LIVE_SCOPE_REQUIRED',
    'NON_ATOMIC_READ_NOT_SECURITY_AUTHORITY'],
   permissions:{...offline.permissions,canDeploy:false,canGrantAuthority:false,canSettle:false,canPost:false}});
}
module.exports={SCOPE_SCHEMA,MAX_PER_BRAND,MAX_PROFILES,MAX_DEVICES_PER_PROFILE,MAX_ESTIMATED_READS,profilePath,globalMarkerPath,checkScope,collectScopedEvidence};

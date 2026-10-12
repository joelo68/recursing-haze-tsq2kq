"use strict";
// Phase L3B2B4A: Pure OFFLINE evidence classifier; NOT a security gate, identity
// authority, Firestore reader, or approval for financial posting/deployment.
const BRANDS=Object.freeze(["cyj","anniu","yibo"]);
const BLOCK_STATUSES=new Set(["blocked","global_blocked","manual_global_blocked"]);
const RISKY_STATUSES=new Set(["new","observing","reverify_required","suspicious","blocked","global_blocked"]);
const RISKY_SOURCES=new Set(["manual_observing","manual_reverify_required","manual_suspicious","manual_blocked","manual_global_blocked","self_reported_not_me"]);
const ROLES=new Set(["director","manager","trainer","store","therapist"]);
const SCHEMA="activity-sales-l3b2b4-offline-snapshot-v1";
const MAX_PROFILES=120,MAX_DEVICES=100,MAX_TOTAL_DEVICES=1500;
function plain(x){return x!==null&&typeof x==="object"&&!Array.isArray(x)&&(Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null);}
function fail(){const e=new Error("L3B2B4_SNAPSHOT_INVALID");e.code="L3B2B4_SNAPSHOT_INVALID";throw e;}
function safeKey(s){return typeof s==="string"&&s.length>0&&s.length<=160&& !/[\/.#$\[\]\s\0]/.test(s);}
function activeGlobalBlock(x){return plain(x)&&x.active!==false&&BLOCK_STATUSES.has(String(x.status||x.source||""));}
function acceptsLegacyTrust(x){return plain(x)&&x.trusted!==false&& !RISKY_STATUSES.has(String(x.status||""))&&!RISKY_SOURCES.has(String(x.source||""));}
function auditOfflineSnapshot(raw){
  if(!plain(raw)||raw.schemaVersion!==SCHEMA||!Array.isArray(raw.profiles)||raw.profiles.length>MAX_PROFILES||
    Object.keys(raw).some(k=>!["schemaVersion","profiles"].includes(k)))fail();
  const uniqueProfiles=new Set(),seenBrands=new Set();
  const counts={profiles:0,devices:0,legacyImplicitTrust:0,fingerprintAliases:0,blockedAliasConflicts:0,
    missingFingerprints:0,unreadGlobalMarkers:0,activeGlobalBlockConflicts:0,ambiguousGlobalBlockRecords:0};
  const findings=[];
  const record=(code,brandId,profileId,number=1)=>findings.push({code,brandId,profileId,count:number});
  for(const profile of raw.profiles){
    if(!plain(profile)||Object.keys(profile).some(k=>!["brandId","roleId","accountId","devices","globalMarkers"].includes(k))||
      !BRANDS.includes(profile.brandId)||!ROLES.has(profile.roleId)||!safeKey(profile.accountId)||
      !plain(profile.devices)||!plain(profile.globalMarkers))fail();
    const {brandId,roleId,accountId,devices,globalMarkers}=profile;
    const unique=`${brandId}\0${roleId}\0${accountId}`;
    if(uniqueProfiles.has(unique))fail();uniqueProfiles.add(unique);seenBrands.add(brandId);
    const ids=Object.keys(devices);
    if(ids.length>MAX_DEVICES||counts.devices+ids.length>MAX_TOTAL_DEVICES)fail();
    const profileId=`profile_${String(counts.profiles+1).padStart(4,"0")}`;
    const groups=new Map(),blocked=new Map();
    for(const id of ids){
      const d=devices[id];
      if(!safeKey(id)||!plain(d)||Object.keys(d).some(k=>!["trusted","status","source","deviceFingerprint"].includes(k))||
        (d.trusted!==undefined&&typeof d.trusted!=="boolean")||
        (d.status!==undefined&&typeof d.status!=="string")||
        (d.source!==undefined&&typeof d.source!=="string")||
        (d.deviceFingerprint!==undefined&&typeof d.deviceFingerprint!=="string"))fail();
      counts.devices++;
      if(d.trusted===undefined&&acceptsLegacyTrust(d)){
        counts.legacyImplicitTrust++;record("LEGACY_IMPLICIT_TRUST",brandId,profileId);
      }
      if(!d.deviceFingerprint){counts.missingFingerprints++;record("FINGERPRINT_UNAVAILABLE",brandId,profileId);}
      else if(d.deviceFingerprint.length>256)fail();
      else groups.set(d.deviceFingerprint,[...(groups.get(d.deviceFingerprint)||[]),id]);
      if(!Object.prototype.hasOwnProperty.call(globalMarkers,id)){
        counts.unreadGlobalMarkers++;record("GLOBAL_MARKER_NOT_PROVIDED",brandId,profileId);blocked.set(id,null);
      }else{
        const marker=globalMarkers[id];
        if(marker!==null&&(!plain(marker)||Object.keys(marker).some(k=>!["active","status","source"].includes(k))||
          (marker.active!==undefined&&typeof marker.active!=="boolean")||
          (marker.status!==undefined&&typeof marker.status!=="string")||
          (marker.source!==undefined&&typeof marker.source!=="string")))fail();
        const isBlocked=activeGlobalBlock(marker);blocked.set(id,isBlocked);
        if(marker!==null&&marker.active!==false&&!isBlocked&&
          (BLOCK_STATUSES.has(String(marker.source||""))||BLOCK_STATUSES.has(String(marker.status||"")))){
          counts.ambiguousGlobalBlockRecords++;record("GLOBAL_BLOCK_STATUS_SOURCE_AMBIGUOUS",brandId,profileId);
        }
        if(isBlocked&&acceptsLegacyTrust(d)){
          counts.activeGlobalBlockConflicts++;record("TRUSTED_DEVICE_HAS_GLOBAL_BLOCK",brandId,profileId);
        }
      }
    }
    for(const groupIds of groups.values()){
      if(groupIds.length<2)continue;
      counts.fingerprintAliases++;record("FINGERPRINT_ALIAS_CLUSTER",brandId,profileId,groupIds.length);
      if(groupIds.some(id=>blocked.get(id)===true)&&groupIds.some(id=>blocked.get(id)!==true&&acceptsLegacyTrust(devices[id]))){
        counts.blockedAliasConflicts++;record("BLOCKED_FINGERPRINT_ALIAS_REVIEW",brandId,profileId);
      }
    }
    // A marker supplied without a corresponding device is not proof of a read;
    // only exact device IDs are within this bounded snapshot scope.
    if(Object.keys(globalMarkers).some(id=>!Object.prototype.hasOwnProperty.call(devices,id)))fail();
    counts.profiles++;
  }
  const brandsMissing=BRANDS.filter(b=>!seenBrands.has(b));
  return Object.freeze({schemaVersion:"activity-sales-l3b2b4-offline-audit-v1",status:"HOLD_NO_POSTING",
    inputAuthority:"UNAUTHENTICATED_OFFLINE_SNAPSHOT",brandCoverage:{seen:[...seenBrands].sort(),missing:brandsMissing},
    counts,findings,requiredGates:["AUTHORITATIVE_BRAND_SCOPED_DEVICE_SNAPSHOT_REQUIRED",
      "GLOBAL_MARKER_AND_ALIAS_REVIEW_REQUIRED","HISTORICAL_TRUST_MIGRATION_POLICY_REQUIRED",
      "NINE_ACCOUNTING_DECISIONS_NOT_APPROVED","MANAGEMENT_ENTRYPOINT_AND_FULL_SECURITY_REGRESSION_REQUIRED"],
    permissions:{canDeploy:false,canGrantAuthority:false,canSettle:false,canPost:false,formalRevenueDelta:0,
      financialPeriodAuthority:"NOT_GRANTED",officialKpiAllocation:"UNDECIDED"}});
}
module.exports={SCHEMA,BRANDS,MAX_PROFILES,MAX_DEVICES,MAX_TOTAL_DEVICES,activeGlobalBlock,acceptsLegacyTrust,auditOfflineSnapshot};

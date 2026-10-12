"use strict";
// L3B2B3: ISOLATED and UNREGISTERED management writer. Super-admin grant/revoke ONLY.
// Do not add an exports entry to functions/index.js until a separate release gate.
const {assertActivitySalesSessionActor}=require("./activitySalesSessionBoundary");
const {activitySalesServerTimestamp}=require("./activitySalesFirestoreFieldValue");
const {checkedAuthorityBody,buildNextAuthority,inspectStored}=require("./activitySalesSpecialPriceSignoffAuthorityManagementContract");
const {parseSignoffAuthority}=require("./activitySalesSpecialPricePolicySignoffContract");
const AUTH_DOC={director:"director_auth",manager:"manager_auth",trainer:"trainer_auth",store:"store_account_data"};
const ROLES=new Set(Object.keys(AUTH_DOC).concat("therapist"));
function reject(code,status=409){const e=new Error(code);e.code=code;e.status=status;throw e;}
function actorActive(actor,data){
  if(!data||typeof data!=="object")return false;
  const id=actor.accountId,role=actor.roleId;
  let row;
  if(role==="therapist"){
    if(String(data.id||data.therapistId||"")!==id)return false;
    row=data;
  }else if(role==="store"){
    row=Array.isArray(data.accounts)?data.accounts.find(x=>String(x?.id||x?.name||"")===id):null;
  }else if(role==="manager"){
    row=data[id];
  }else if(role==="director"||role==="trainer"){
    const accounts=data.accounts&&typeof data.accounts==="object"?data.accounts:{};
    row=accounts[id]||Object.values(accounts).find(x=>String(x?.id||x?.name||"")===id);
    if(!row&&role==="director")row=data[id];
  }
  return Boolean(row && typeof row==="object" && row.isActive!==false && row.disabled!==true &&
    row.resigned!==true && row.isResigned!==true &&
    !["resigned","離職","封存"].includes(String(row.status||"").trim().toLowerCase()));
}
// Read-only adapter: the existing upstream super-admin verifier MUST re-read its
// device profile + director/master credential documents through the SAME Firestore
// transaction as the authority write. This avoids duplicating password semantics.
// Never expose a write method: this view is for exact document reads only.
function transactionReadView(db,tx){
  const wrap=ref=>({get:()=>tx.get(ref),doc:id=>wrap(ref.doc(id)),collection:name=>wrap(ref.collection(name))});
  return Object.freeze({doc:path=>wrap(db.doc(path)),collection:path=>wrap(db.collection(path))});
}
function assertFreshSuperAdmin(check,who){
  if(!check?.ok || check.actorRole!=="director" || check.isMasterCredential!==false ||
     check.actorAccountId!==who.accountId)reject("SIGNOFF_AUTHORITY_SUPER_ADMIN_REVOKED",403);
}
function createSpecialPriceSignoffAuthorityManagementHandler({admin,db,services={}}){
  const deps=services.requireFirebaseRequestAuth&&services.verifySuperAdminActor&&services.getBrandCollection&&services.getBrandSettingDoc
    ?services:{...require("./deviceApproval"),...services};
  const {requireFirebaseRequestAuth,verifySuperAdminActor,getBrandCollection,getBrandSettingDoc}=deps;
  return async(req,res)=>{
    if(req.method!=="POST")return res.status(405).json({ok:false,code:"METHOD_NOT_ALLOWED"});
    try{
      const {get,set,body}=checkedAuthorityBody(req.body),who=body.actor;
      const auth=await requireFirebaseRequestAuth(req,admin);
      if(!auth?.ok)return res.status(401).json({ok:false,code:"AUTH_EXPIRED"});
      assertActivitySalesSessionActor(auth,body.brandId,who);
      const adminCheck=await verifySuperAdminActor({db,brandId:body.brandId,actor:who});
      // Only a current director super_admin identity may provision these signers;
      // master-credential fallback needs separate user authorization and is denied.
      if(!adminCheck?.ok||adminCheck.actorRole!=="director"||adminCheck.isMasterCredential!==false||
        adminCheck.actorAccountId!==who.accountId)
        reject("SIGNOFF_AUTHORITY_SUPER_ADMIN_REQUIRED",403);
      const col=name=>getBrandCollection(db,body.brandId,name);
      const authorityRef=col("activity_sales_special_price_signoff_authority").doc("current");
      if(get){
        const snap=await authorityRef.get();
        const current=snap.exists?inspectStored(snap.data(),body.brandId):null;
        return res.status(200).json({ok:true,brandId:body.brandId,revision:current?.revision??0,
          enabled:current?.enabled??false,reviewers:current?.reviewers??{BUSINESS:[],FINANCE:[]},
          postingAllowed:false,formalRevenueDelta:0,officialKpiAllocation:"UNDECIDED"});
      }
      const targets=set?[...body.reviewers.BUSINESS,...body.reviewers.FINANCE]:[];
      // Only exact, brand-private document reads. Dedupe directory references.
      const reviewerRefs=new Map();
      for(const target of targets){
        if(!ROLES.has(target.roleId))reject("SIGNOFF_AUTHORITY_REVIEWER_INVALID",400);
        const ref=target.roleId==="therapist"?col("therapists").doc(target.accountId):
          getBrandSettingDoc(db,body.brandId,AUTH_DOC[target.roleId]);
        reviewerRefs.set(ref.path,ref);
      }
      const outcome=await db.runTransaction(async tx=>{
        // Reauthenticate against fresh transaction snapshots. The outer check is
        // only an early 403; it is NEVER sufficient to authorize a write.
        // A simultaneous password/role/device revocation changes one of these
        // read documents, causing Firestore OCC retry and a fresh denial.
        const freshAdmin=await verifySuperAdminActor({db:transactionReadView(db,tx),brandId:body.brandId,actor:who});
        assertFreshSuperAdmin(freshAdmin,who);
        const [authoritySnap,...accountSnaps]=await Promise.all([
          tx.get(authorityRef),...Array.from(reviewerRefs.values()).map(ref=>tx.get(ref))]);
        const current=authoritySnap.exists?authoritySnap.data():null;
        const result=buildNextAuthority({brandId:body.brandId,expectedRevision:body.expectedRevision,
          stored:current,enabled:set,reviewers:set?body.reviewers:undefined});
        if(set){
          const directories=new Map(Array.from(reviewerRefs.keys()).map((path,i)=>[path,accountSnaps[i]]));
          for(const target of targets){
            const ref=target.roleId==="therapist"?col("therapists").doc(target.accountId):
              getBrandSettingDoc(db,body.brandId,AUTH_DOC[target.roleId]);
            const snap=directories.get(ref.path);
            if(!snap?.exists||!actorActive(target,snap.data()))reject("SIGNOFF_AUTHORITY_REVIEWER_INACTIVE",409);
          }
        }
        const next=result.next,nowText=(services.now?.()||new Date()).toISOString();
        const auditRef=col("activity_sales_special_price_signoff_authority_audit").doc(`revision_${String(next.revision).padStart(12,"0")}`);
        const stamp=activitySalesServerTimestamp(admin);
        const beforeHash=current?.enabled===true?parseSignoffAuthority(current,body.brandId).authorityHash:null;
        // Append-only audit and authority write share a single transaction; OCC
        // transaction retry re-evaluates permissions roster and current revision.
        tx.create(auditRef,{schemaVersion:"activity-sales-special-price-signoff-authority-audit-v1",
          brandId:body.brandId,revision:next.revision,priorRevision:result.previousRevision,
          action:set?"SET":"DISABLE",actorRole:adminCheck.actorRole,actorAccountId:adminCheck.actorAccountId,
          previousHash:beforeHash,nextHash:result.authorityHash,enabled:next.enabled,
          reviewers:next.reviewers,postingAllowed:false,formalRevenueDelta:0,
          officialKpiAllocation:"UNDECIDED",createdAt:stamp,createdAtText:nowText});
        // Exact schema required by L3B2B1 parseSignoffAuthority (no metadata fields).
        tx.set(authorityRef,next,{merge:false});
        return {state:set?"updated":"disabled",brandId:body.brandId,revision:next.revision,
          enabled:next.enabled,authorityHash:result.authorityHash,postingAllowed:false,
          formalRevenueDelta:0,officialKpiAllocation:"UNDECIDED"};
      });
      return res.status(200).json({ok:true,...outcome});
    }catch(e){
      const code=String(e?.code||e?.message||"SIGNOFF_AUTHORITY_FAILED");
      const status=Number(e?.status||(code.startsWith("SIGNOFF_AUTHORITY_")?409:code.startsWith("ACTIVITY_")?403:500));
      if(status>=500)console.error("isolated signoff authority management failed",e);
      return res.status(status).json({ok:false,code:status>=500?"SIGNOFF_AUTHORITY_FAILED":code});
    }
  };
}
module.exports={createSpecialPriceSignoffAuthorityManagementHandler,actorActive,transactionReadView,assertFreshSuperAdmin};

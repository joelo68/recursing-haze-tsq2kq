"use strict";
// L3B2B2 isolated / UNREGISTERED: signoff-only backend. Never creates sales or grants posting.
const {assertActivitySalesSessionActor}=require("./activitySalesSessionBoundary");
const {validIdentity,attributionDocumentId}=require("./activitySalesAttributionContract");
const {ownerStore,reportKey,summaryDocumentId,invalid}=require("./activitySalesAttributionWriterLogic");
const {activitySalesServerTimestamp}=require("./activitySalesFirestoreFieldValue");
const {verifyActorActive}=require("./activitySalesLifecycleReviewWriter");
const {specialPriceRequestId}=require("./activitySalesSpecialPriceRequestContract");
const {assertSpecialPriceSettlementPreflight}=require("./activitySalesSpecialPriceSettlementGate");
const {buildSpecialPriceRecognitionWorksheet,DECISION_CODES}=require("./activitySalesSpecialPriceRecognitionWorksheet");
const {buildSpecialPricePolicyDecisionDraft}=require("./activitySalesSpecialPricePolicyDecisionDraft");
const {beginSignoff,applySignoffDecision,parseSignoffAuthority}=require("./activitySalesSpecialPricePolicySignoffContract");

const BRANDS=new Set(["cyj","anniu","yibo"]);
const ROLES=["director","manager","trainer","store","therapist"];
const AUTH_DOC={director:"director_auth",manager:"manager_auth",trainer:"trainer_auth",store:"store_account_data"};
const ACTOR_FIELDS=new Set(["roleId","accountId","deviceId","credentialPassword"]);
const BEGIN_FIELDS=new Set(["action","brandId","requestId","expectedDailyRevision","proposals","actor"]);
const DECIDE_FIELDS=new Set(["action","brandId","requestId","expectedReviewRevision","decision","reasonNote","actor"]);
const RECORD_SCHEMA="activity-sales-special-price-policy-signoff-record-v1";
const AUDIT_SCHEMA="activity-sales-special-price-policy-signoff-audit-v1";

function checkedBody(body){
  if(!body || typeof body!=="object" || Array.isArray(body))invalid("SPECIAL_PRICE_SIGNOFF_INPUT_INVALID",400);
  const opening=body.action==="open_special_price_signoff",deciding=body.action==="decide_special_price_signoff";
  const fields=opening?BEGIN_FIELDS:deciding?DECIDE_FIELDS:null;
  if(!fields || Object.keys(body).some(k=>!fields.has(k)) || !BRANDS.has(body.brandId) ||
    typeof body.requestId!=="string" || !/^price_[a-f0-9]{48}$/.test(body.requestId) ||
    !body.actor || typeof body.actor!=="object" || Array.isArray(body.actor) ||
    Object.keys(body.actor).some(k=>!ACTOR_FIELDS.has(k)) || !ROLES.includes(body.actor.roleId) ||
    typeof body.actor.accountId!=="string" || body.actor.accountId.length<1 || body.actor.accountId.length>160 ||
    /[\/\u0000-\u001f\u007f]/.test(body.actor.accountId))invalid("SPECIAL_PRICE_SIGNOFF_INPUT_INVALID",400);
  if(opening){
    if(!Number.isSafeInteger(body.expectedDailyRevision) || body.expectedDailyRevision<0 ||
      !body.proposals || typeof body.proposals!=="object" || Array.isArray(body.proposals) ||
      Object.keys(body.proposals).length!==DECISION_CODES.length ||
      !Object.keys(body.proposals).every(code=>DECISION_CODES.includes(code) &&
        body.proposals[code] && typeof body.proposals[code]==="object" && !Array.isArray(body.proposals[code]) &&
        Object.keys(body.proposals[code]).sort().join(",")==="rationale,text" &&
        [body.proposals[code].text,body.proposals[code].rationale].every(value=>
          typeof value==="string" && value===value.trim() && value.length>=3 && value.length<=800 &&
          !/[\u0000-\u001f\u007f]/.test(value))))invalid("SPECIAL_PRICE_SIGNOFF_INPUT_INVALID",400);
  }else if(!Number.isSafeInteger(body.expectedReviewRevision) || body.expectedReviewRevision<0 ||
    !["APPROVE","REJECT"].includes(body.decision) ||
    (body.reasonNote!==undefined && typeof body.reasonNote!=="string"))invalid("SPECIAL_PRICE_SIGNOFF_INPUT_INVALID",400);
  return {body,opening};
}
function actorDocRef({db,col,getBrandSettingDoc,brandId,who}){
  return who.roleId==="therapist"?col("therapists").doc(who.accountId):
    getBrandSettingDoc(db,brandId,AUTH_DOC[who.roleId]);
}
function sellerStore(request,seller){
  const p=request.proposal;
  if(p.roleId==="therapist"){
    if(!seller?.exists)invalid("SPECIAL_PRICE_SIGNOFF_SELLER_REVOKED",403);
    return ownerStore({roleId:"therapist",accountId:p.accountId,therapistMaster:seller.data(),targetStore:request.storeName});
  }
  const rows=seller?.exists?seller.data()?.accounts:null;
  const row=Array.isArray(rows)?rows.find(r=>String(r?.id||r?.name||"")===p.accountId):null;
  if(!row || row.isActive===false || row.disabled===true || row.resigned===true)invalid("SPECIAL_PRICE_SIGNOFF_SELLER_REVOKED",403);
  const stores=Array.isArray(row.stores)?row.stores:[row.storeName||row.store].filter(Boolean);
  return ownerStore({roleId:"store",accountId:p.accountId,credential:{stores},targetStore:request.storeName});
}
function proposalsFromDraft(draft){
  if(!Array.isArray(draft?.decisions))invalid("SPECIAL_PRICE_SIGNOFF_DRAFT_MISSING",409);
  return Object.fromEntries(draft.decisions.map(d=>[d.code,{text:d.proposalText,rationale:d.rationale}]));
}
function createSpecialPricePolicySignoffHandler({admin,db,services={}}){
  const deps=services.requireFirebaseRequestAuth&&services.verifyTrustedApplicationActor&&services.getBrandCollection&&services.getBrandSettingDoc
    ?services:{...require("./deviceApproval"),...services};
  const {requireFirebaseRequestAuth,verifyTrustedApplicationActor,getBrandCollection,getBrandSettingDoc}=deps;
  return async (req,res)=>{
    if(req.method!=="POST")return res.status(405).json({ok:false,code:"METHOD_NOT_ALLOWED"});
    try{
      const {body,opening}=checkedBody(req.body),who=body.actor;
      const auth=await requireFirebaseRequestAuth(req,admin);
      if(!auth?.ok)return res.status(401).json({ok:false,code:"AUTH_EXPIRED"});
      assertActivitySalesSessionActor(auth,body.brandId,who);
      const verified=await verifyTrustedApplicationActor({db,brandId:body.brandId,actor:who,allowedRoles:ROLES});
      if(!verified?.ok || verified.actorRole!==who.roleId || verified.actorAccountId!==who.accountId)
        invalid("SPECIAL_PRICE_SIGNOFF_UNTRUSTED_ACTOR",403);
      const col=name=>getBrandCollection(db,body.brandId,name);
      const ref={
        authority:col("activity_sales_special_price_signoff_authority").doc("current"),
        record:col("activity_sales_special_price_signoffs").doc(body.requestId),
        request:col("activity_sales_special_price_requests").doc(body.requestId),
        review:col("activity_sales_special_price_review_state").doc(body.requestId),
        policy:col("activity_sales_lifecycle_review_policy").doc("current"),
      };
      const currentActor={roleId:verified.actorRole,accountId:verified.actorAccountId};
      const actorRef=actorDocRef({db,col,getBrandSettingDoc,brandId:body.brandId,who:currentActor});
      const response=await db.runTransaction(async tx=>{
        // First read fixed brand-private anchors. Never trust client-provided paths, draft, policy or approval.
        const [authoritySnap,recordSnap,requestSnap,reviewSnap,policySnap,actorSnap]=await Promise.all([
          tx.get(ref.authority),tx.get(ref.record),tx.get(ref.request),tx.get(ref.review),tx.get(ref.policy),tx.get(actorRef)]);
        if(!authoritySnap.exists || !policySnap.exists || !requestSnap.exists || !reviewSnap.exists)
          invalid("SPECIAL_PRICE_SIGNOFF_ANCHOR_MISSING",409);
        const request=requestSnap.data(),proposal=request?.proposal;
        let identity;
        try{identity=validIdentity(proposal);}catch{invalid("SPECIAL_PRICE_SIGNOFF_IDENTITY_INVALID",409);}
        if(identity.brandId!==body.brandId || specialPriceRequestId(identity,proposal.saleId)!==body.requestId ||
          request.requestId!==body.requestId || request.brandId!==body.brandId ||
          typeof request.reportDocId!=="string" || request.reportDocId.length<1 || request.reportDocId.length>180 ||
          /[\\/\u0000-\u001f\u007f]/.test(request.reportDocId) ||
          typeof request.storeName!=="string" || !request.storeName || request.storeName.length>120 ||
          /[\\/\u0000-\u001f\u007f]/.test(request.storeName) ||
          request.reportDocId!==reportKey(identity,request.storeName))
          invalid("SPECIAL_PRICE_SIGNOFF_REQUEST_INVALID",409);
        const sellerRef=actorDocRef({db,col,getBrandSettingDoc,brandId:body.brandId,who:{roleId:identity.roleId,accountId:identity.accountId}});
        const saleKey=attributionDocumentId(identity,proposal.saleId);
        const sub={
          lock:col("activity_sales_special_price_request_state").doc(saleKey),
          dayLock:col("activity_sales_special_price_day_locks").doc(summaryDocumentId(identity)),
          report:col(identity.roleId==="therapist"?"therapist_daily_reports":"daily_reports").doc(request.reportDocId),
          pub:col("activity_sales_publications").doc(identity.campaignId),
          version:col("activity_campaign_versions").doc(identity.versionId),
          sale:col("activity_sales_attribution_sales").doc(saleKey),
          lifecycle:col("activity_sales_lifecycle_request_state").doc(saleKey),
          daily:col("activity_sales_daily_attributions").doc(summaryDocumentId(identity)),
        };
        const [sellerSnap,lockSnap,dayLockSnap,reportSnap,pubSnap,versionSnap,saleSnap,lifecycleSnap,dailySnap]=await Promise.all([
          tx.get(sellerRef),tx.get(sub.lock),tx.get(sub.dayLock),tx.get(sub.report),tx.get(sub.pub),
          tx.get(sub.version),tx.get(sub.sale),tx.get(sub.lifecycle),tx.get(sub.daily)]);
        const storeCore=sellerStore(request,sellerSnap);
        if(storeCore!==request.storeCore)invalid("SPECIAL_PRICE_SIGNOFF_STORE_CHANGED",409);
        if(opening){
          if(currentActor.roleId!==identity.roleId || currentActor.accountId!==identity.accountId)
            invalid("SPECIAL_PRICE_SIGNOFF_CREATOR_FORBIDDEN",403);
          verifyActorActive(currentActor.roleId,currentActor.accountId,actorSnap.exists?actorSnap.data():null,storeCore);
        }else verifyActorActive(currentActor.roleId,currentActor.accountId,actorSnap.exists?actorSnap.data():null,storeCore);
        // Therapist reviewers must still currently belong to this specific store.
        // A named policy reviewer is NOT automatic cross-store authority.
        if(currentActor.roleId==="therapist"){
          const reviewedStore=ownerStore({roleId:"therapist",accountId:currentActor.accountId,
            therapistMaster:actorSnap.exists?actorSnap.data():null,targetStore:request.storeName});
          if(reviewedStore!==storeCore)invalid("SPECIAL_PRICE_SIGNOFF_REVIEWER_STORE_CHANGED",403);
        }
        const prior=recordSnap.exists?recordSnap.data():null;
        if(opening && prior)invalid("SPECIAL_PRICE_SIGNOFF_ALREADY_OPEN",409);
        if(!opening && (!prior || prior.schemaVersion!==RECORD_SCHEMA || prior.brandId!==body.brandId ||
           prior.requestId!==body.requestId || prior.postingAllowed!==false || prior.formalRevenueDelta!==0 ||
           prior.officialKpiAllocation!=="UNDECIDED"))invalid("SPECIAL_PRICE_SIGNOFF_RECORD_INVALID",409);
        const expectedDailyRevision=opening?body.expectedDailyRevision:prior.draft?.expectedDailyRevision;
        const preflight=assertSpecialPriceSettlementPreflight({
          brandId:body.brandId,requestId:body.requestId,request,
          requestState:lockSnap.exists?lockSnap.data():null,
          review:reviewSnap.data(),policy:policySnap.data(),dayLock:dayLockSnap.exists?dayLockSnap.data():null,
          publication:pubSnap.exists?pubSnap.data():null,version:versionSnap.exists?versionSnap.data():null,
          report:reportSnap.exists?reportSnap.data():null,sellerStoreCore:storeCore,
          existingSale:saleSnap.exists?saleSnap.data():null,lifecycleLock:lifecycleSnap.exists?lifecycleSnap.data():null,
          daily:dailySnap.exists?dailySnap.data():null,expectedDailyRevision});
        const worksheet=buildSpecialPriceRecognitionWorksheet({preflight,request,review:reviewSnap.data()});
        const proposals=opening?body.proposals:proposalsFromDraft(prior.draft);
        const draft=buildSpecialPricePolicyDecisionDraft({worksheet,proposals});
        const authority=authoritySnap.data(),plan=parseSignoffAuthority(authority,body.brandId);
        const now=(services.now?.()||new Date()).toISOString();
        const stamp=activitySalesServerTimestamp(admin);
        if(opening){
          const state=beginSignoff({authority,draft,requestedBy:currentActor});
          const auditRef=col("activity_sales_special_price_signoff_audit").doc(`${body.requestId}_0`);
          tx.create(ref.record,{schemaVersion:RECORD_SCHEMA,brandId:body.brandId,requestId:body.requestId,
            draft,signoffState:state,postingAllowed:false,formalRevenueDelta:0,officialKpiAllocation:"UNDECIDED"});
          tx.create(auditRef,{schemaVersion:AUDIT_SCHEMA,brandId:body.brandId,requestId:body.requestId,
            action:"BEGIN",actor:currentActor,revision:0,signoffId:state.signoffId,
            draftFingerprint:draft.draftFingerprint,authorityRevision:plan.revision,authorityHash:plan.authorityHash,
            postingAllowed:false,formalRevenueDelta:0,officialKpiAllocation:"UNDECIDED",createdAt:stamp,createdAtText:now});
          return {state:"opened",status:state.status,reviewRevision:0,signoffId:state.signoffId,
            postingAllowed:false,formalRevenueDelta:0,officialKpiAllocation:"UNDECIDED"};
        }
        if(JSON.stringify(draft)!==JSON.stringify(prior.draft))invalid("SPECIAL_PRICE_SIGNOFF_DRAFT_STALE",409);
        const decision=applySignoffDecision({authority,draft,prior:prior.signoffState,
          actor:currentActor,decision:body.decision,reasonNote:body.reasonNote||"",
          expectedRevision:body.expectedReviewRevision});
        const auditRef=col("activity_sales_special_price_signoff_audit").doc(`${body.requestId}_${decision.next.reviewRevision}`);
        tx.create(auditRef,{schemaVersion:AUDIT_SCHEMA,...decision.decisionRecord,
          action:"DECIDE",postingAllowed:false,createdAt:stamp,createdAtText:now});
        tx.set(ref.record,{...prior,signoffState:decision.next},{merge:false});
        return {state:"written",status:decision.next.status,reviewRevision:decision.next.reviewRevision,
          signoffId:decision.next.signoffId,postingAllowed:false,formalRevenueDelta:0,officialKpiAllocation:"UNDECIDED"};
      });
      return res.status(200).json({ok:true,...response});
    }catch(e){
      const code=String(e?.code||e?.message||"SPECIAL_PRICE_SIGNOFF_FAILED");
      const status=Number(e?.status||(code.startsWith("SPECIAL_PRICE_")||code.startsWith("ATTRIBUTION_")||code.startsWith("ACTIVITY_")||code.startsWith("LIFECYCLE_")?409:500));
      if(status>=500)console.error("isolated special-price policy signoff failed",e);
      return res.status(status).json({ok:false,code:status>=500?"SPECIAL_PRICE_SIGNOFF_FAILED":code});
    }
  };
}
module.exports={createSpecialPricePolicySignoffHandler,checkedBody,RECORD_SCHEMA,AUDIT_SCHEMA};

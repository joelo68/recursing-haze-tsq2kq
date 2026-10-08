"use strict";
const {activitySalesServerTimestamp} = require("./activitySalesFirestoreFieldValue");

const {assertActivitySalesSessionActor} = require("./activitySalesSessionBoundary");
const {
  normalizeAcknowledgementIdentity, acknowledgementDocumentId,isCurrentPublication,
} = require("./activitySalesAcknowledgementLogic");

function createAcknowledgementHandler({admin,db,services={}}) {
  const {
    requireFirebaseRequestAuth, verifyTrustedApplicationActor, getBrandCollection,
  } = services.requireFirebaseRequestAuth && services.verifyTrustedApplicationActor && services.getBrandCollection
    ? services : {...require("./deviceApproval"), ...services};
  return async function handleAcknowledgement(req,res) {
    if (req.method !== "POST") return res.status(405).json({ok:false,code:"METHOD_NOT_ALLOWED"});
    try {
      const body=req.body || {};
      const identity=normalizeAcknowledgementIdentity({
        brandId:body.brandId,campaignId:body.campaignId,versionId:body.versionId,
        roleId:body.actor?.roleId,accountId:body.actor?.accountId,
      });
      if (!["status","acknowledge"].includes(body.action)) {
        return res.status(400).json({ok:false,code:"ACK_ACTION_INVALID"});
      }
      const auth=await requireFirebaseRequestAuth(req,admin);
      if (!auth.ok) return res.status(401).json({ok:false,code:"AUTH_EXPIRED"});
      assertActivitySalesSessionActor(auth,identity.brandId,body.actor || {});
      const actor=await verifyTrustedApplicationActor({
        db,brandId:identity.brandId,actor:body.actor || {},allowedRoles:[],
      });
      if (!actor.ok || actor.actorRole !== identity.roleId ||
          actor.actorAccountId !== identity.accountId) {
        return res.status(403).json({ok:false,code:"ACK_ACTOR_FORBIDDEN"});
      }
      if (body.action==="acknowledge" && body.confirmUnderstood !== true) {
        return res.status(400).json({ok:false,code:"ACK_CONFIRM_REQUIRED"});
      }
      const col=(name)=>getBrandCollection(db,identity.brandId,name);
      const pubRef=col("activity_sales_publications").doc(identity.campaignId);
      const ackRef=col("activity_sales_acknowledgements").doc(acknowledgementDocumentId(identity));
      const result=await db.runTransaction(async(tx)=>{
        const pubSnap=await tx.get(pubRef);
        if (!pubSnap.exists || !isCurrentPublication(pubSnap.data(),identity)) {
          return {state:"publication_changed",acknowledged:false};
        }
        const ackSnap=await tx.get(ackRef);
        if (ackSnap.exists) {
          const saved=ackSnap.data() || {};
          if (saved.brandId!==identity.brandId || saved.campaignId!==identity.campaignId ||
              saved.versionId!==identity.versionId || saved.roleId!==identity.roleId ||
              saved.accountId!==identity.accountId) throw new Error("ACK_RECORD_MISMATCH");
          return {state:"existing",acknowledged:true,acknowledgedAtText:saved.acknowledgedAtText || ""};
        }
        if (body.action==="status") return {state:"not_acked",acknowledged:false};
        const timestamp=new Date().toISOString();
        // Immutable per campaign version + verified identity, never overwrite or reuse.
        tx.create(ackRef,{
          schemaVersion:"activity-sales-acknowledgement-v1",
          brandId:identity.brandId,campaignId:identity.campaignId,versionId:identity.versionId,
          roleId:identity.roleId,accountId:identity.accountId,
          acknowledgedAt:activitySalesServerTimestamp(admin),
          acknowledgedAtText:timestamp,
        });
        return {state:"created",acknowledged:true,acknowledgedAtText:timestamp};
      });
      if (result.state==="publication_changed") {
        return res.status(409).json({ok:false,code:"ACK_PUBLICATION_CHANGED",
          message:"此活動的正式版本已更新或停止發布，請重新載入"});
      }
      return res.status(200).json({ok:true,campaignId:identity.campaignId,
        versionId:identity.versionId,...result});
    } catch(err) {
      const status=Number(err?.status || (err?.message==="ACK_IDENTITY_INVALID" ? 400 : 500));
      if (status>=500) console.error("acknowledgeActivitySalesPublication failed",err);
      return res.status(status).json({ok:false,code:err?.code || err?.message || "ACK_FAILED",
        message:status>=500?"活動理解確認目前無法完成":err?.message || "確認失敗"});
    }
  };
}

function createActivitySalesAcknowledgementFunctions({admin,db}) {
  const {onRequest}=require("firebase-functions/v2/https");
  return {acknowledgeActivitySalesPublication:onRequest({
    cors:true,timeoutSeconds:20,memory:"256MiB",
  },createAcknowledgementHandler({admin,db}))};
}

module.exports={createAcknowledgementHandler,createActivitySalesAcknowledgementFunctions};

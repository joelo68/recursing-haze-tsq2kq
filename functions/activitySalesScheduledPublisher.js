"use strict";
const {activitySalesServerTimestamp} = require("./activitySalesFirestoreFieldValue");

// Event-driven per-campaign scheduled publishing.
// Firestore onWrite queues one task; no collection scan, listener or periodic polling.
const { buildActivitySalesPublication } = require("./activitySalesPublishedProjection");
const {
  validateScheduleIdentity, isScheduledCandidate, scheduleTransition,
  scheduleDecision, chooseScheduledTaskTime, taipeiCalendarDate,
} = require("./activitySalesScheduleLogic");

function createScheduleEngine({ admin, db, enqueueTask, now = Date.now, getBrandCollection: resolver }) {
  if (typeof enqueueTask !== "function") throw new Error("TASK_ENQUEUER_REQUIRED");
  const getCollection = resolver || require("./deviceApproval").getBrandCollection;
  const collection = (brand, name) => getCollection(db, brand, name);

  async function handleTransition({ brandId, campaignId, before, after }) {
    if (!after || typeof after !== "object") return { state: "skip" };
    const versionId = String(after.currentVersionId || "");
    let identity;
    try { identity = validateScheduleIdentity({brandId, campaignId, versionId}); }
    catch { return { state: "skip" }; }
    if (!scheduleTransition(before || {}, after, identity)) return { state: "skip" };
    const decision = scheduleDecision(after, identity, now());
    if (decision.state === "invalid") {
      throw new Error("ACTIVITY_SCHEDULE_TIME_INVALID");
    }
    if (decision.state !== "requeue" && decision.state !== "publish") return decision;
    const when = chooseScheduledTaskTime(Date.parse(after.scheduledPublishAtText), now());
    await enqueueTask(identity, when);
    return { state: "enqueued", campaignId, versionId, scheduleTime: when.toISOString() };
  }

  async function dispatch(data) {
    const identity = validateScheduleIdentity(data || {});
    const {brandId, campaignId, versionId} = identity;
    const ref = collection(brandId, "activity_campaigns").doc(campaignId);
    const versionRef = collection(brandId, "activity_campaign_versions").doc(versionId);
    const publicationRef = collection(brandId, "activity_sales_publications").doc(campaignId);
    const auditRef = collection(brandId, "activity_sales_audit").doc();
    const executedAtMs = now();

    const outcome = await db.runTransaction(async (tx) => {
      const campaignSnap = await tx.get(ref);
      if (!campaignSnap.exists) return {state:"skip",reason:"campaign_missing"};
      const campaign = campaignSnap.data() || {};
      const decision = scheduleDecision(campaign, identity, now());
      if (decision.state !== "publish") return decision;

      const versionSnap = await tx.get(versionRef);
      if (!versionSnap.exists) throw new Error("ACTIVITY_SCHEDULE_VERSION_MISSING");
      const version = versionSnap.data() || {};
      if (version.brandId !== brandId || version.campaignId !== campaignId ||
          version.versionId !== versionId ||
          version.campaignSnapshot?.approvalPlan?.releaseMode !== "scheduled_after_approval" ||
          Date.parse(version.campaignSnapshot?.approvalPlan?.scheduledPublishAt || "") !==
            Date.parse(campaign.scheduledPublishAtText)) {
        throw new Error("ACTIVITY_SCHEDULE_VERSION_MISMATCH");
      }
      const snapshot = version.campaignSnapshot || {};
      if (!snapshot.endDate || taipeiCalendarDate(now()) > snapshot.endDate) {
        throw new Error("ACTIVITY_SCHEDULE_ALREADY_EXPIRED");
      }

      const stamp = new Date(now()).toISOString();
      tx.set(publicationRef, buildActivitySalesPublication({
        brandId,campaignId,versionId,campaignSnapshot:snapshot,publishedAtText:stamp,
      }), {merge:false});
      tx.set(ref, {
        revision:Number(campaign.revision || 0)+1,
        status:"published",
        publishedAt:activitySalesServerTimestamp(admin),
        publishedAtText:stamp,
        publishedBy:{roleId:"system",accountId:"activity_sales_scheduler",name:"活動排程服務"},
        updatedAt:activitySalesServerTimestamp(admin),
        updatedAtText:stamp,
        updatedBy:{roleId:"system",accountId:"activity_sales_scheduler",name:"活動排程服務"},
      }, {merge:true});
      tx.set(auditRef, {
        schemaVersion:"activity-sales-v1",type:"campaign",action:"scheduled_publish",
        brandId,campaignId,versionId,revision:Number(campaign.revision || 0)+1,
        fromStatus:"approved",toStatus:"published", actor:{
          roleId:"system",accountId:"activity_sales_scheduler",name:"活動排程服務",
        }, createdAt:activitySalesServerTimestamp(admin),createdAtText:stamp,
      },{merge:false});
      return {state:"published",campaignId,versionId};
    });

    if (outcome.state === "requeue") {
      // Long-term (> 30 day) tasks chain at <=25 days; stale tasks are safe to dispatch.
      const currentTime = now();
      const when = chooseScheduledTaskTime(
        Date.parse(outcome.scheduleTime.toISOString()), currentTime
      );
      await enqueueTask(identity, when);
      return {state:"requeued",scheduleTime:when.toISOString()};
    }
    return outcome;
  }
  return { handleTransition, dispatch };
}

function createActivitySalesScheduledPublisherFunctions({ admin, db }) {
  const {onDocumentWritten} = require("firebase-functions/v2/firestore");
  const {onTaskDispatched} = require("firebase-functions/v2/tasks");
  const {getFunctions} = require("firebase-admin/functions");

  const enqueueTask = (identity, scheduleTime) => {
    // Fail closed in Emulator instead of silently enqueueing into real Cloud Tasks.
    if (process.env.FUNCTIONS_EMULATOR === "true") {
      const project = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "";
      if (project !== "demo-drcyj-activity-sales" || !process.env.CLOUD_TASKS_EMULATOR_HOST) {
        throw new Error("ACTIVITY_SALES_LOCAL_TASKS_EMULATOR_REQUIRED");
      }
    }
    return getFunctions().taskQueue("activitySalesScheduledPublish").enqueue(identity, {scheduleTime});
  };
  const engine = createScheduleEngine({admin,db,enqueueTask});

  const cyjCampaignScheduleTrigger = onDocumentWritten({
    document:"artifacts/default-app-id/public/data/activity_campaigns/{campaignId}",
    region:"us-central1", retry:true,
  }, (event) => engine.handleTransition({
    brandId:"cyj",campaignId:event.params.campaignId,
    before:event.data?.before?.data(),after:event.data?.after?.data(),
  }));

  const brandCampaignScheduleTrigger = onDocumentWritten({
    document:"brands/{brandId}/activity_campaigns/{campaignId}",
    region:"us-central1",retry:true,
  }, (event) => engine.handleTransition({
    brandId:event.params.brandId,campaignId:event.params.campaignId,
    before:event.data?.before?.data(),after:event.data?.after?.data(),
  }));

  const activitySalesScheduledPublish = onTaskDispatched({
    region:"us-central1",retryConfig:{maxAttempts:5,minBackoffSeconds:60},
    rateLimits:{maxConcurrentDispatches:5}, timeoutSeconds:120,
  }, async (request) => engine.dispatch(request.data || {}));

  return {cyjCampaignScheduleTrigger,brandCampaignScheduleTrigger,activitySalesScheduledPublish};
}
module.exports = {createScheduleEngine,createActivitySalesScheduledPublisherFunctions};

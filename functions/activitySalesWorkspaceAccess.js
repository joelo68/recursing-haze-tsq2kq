"use strict";

// Phase 1C: pure, fail-closed access decisions for private Activity Sales workspace reads.
// The HTTP entry point must authenticate the brand, application identity, trusted device,
// and fresh credential BEFORE using these helpers. Browser Firestore reads remain denied.
const actorId = (value = {}) => ({
  roleId: String(value.actorRole || value.roleId || "").trim(),
  accountId: String(value.actorAccountId || value.accountId || "").trim(),
});
const sameActor = (a = {}, b = {}) => {
  const left = actorId(a);
  const right = actorId(b);
  return Boolean(left.roleId && left.accountId && left.roleId === right.roleId && left.accountId === right.accountId);
};
function activeApprovalStep(approval = {}) {
  if (approval.status !== "pending" || !Array.isArray(approval.steps)) return null;
  const index = Number(approval.currentStepIndex);
  if (!Number.isInteger(index) || index < 0 || index >= approval.steps.length) return null;
  return approval.steps[index] || null;
}
function reviewerState(approval = {}, actor = {}) {
  const step = activeApprovalStep(approval);
  if (!step) return { isReviewer: false, canApprove: false, alreadyActed: false };
  const isReviewer = Array.isArray(step.members) && step.members.some((member) => sameActor(member, actor));
  const alreadyActed = Object.values(approval.decisions || {}).some((decision) =>
    decision && decision.stepId === step.stepId && sameActor(decision.actor, actor)
  );
  const creatorRestricted = approval.allowCreatorApproval !== true && sameActor(approval.creator, actor);
  return { isReviewer, alreadyActed, canApprove: isReviewer && !alreadyActed && !creatorRestricted };
}
function workspaceAccess({ actor = {}, campaign = {}, approval = {}, canCreate = false, canPublish = false } = {}) {
  const review = reviewerState(approval, actor);
  const isCreator = sameActor(campaign.createdBy, actor);
  // Revoked creator membership does not preserve read access; pending approvers retain
  // access based on their immutable submission-time snapshot.
  const canRead = Boolean(canCreate || canPublish || review.isReviewer);
  const amendment = campaign.status === "published" ? campaign.amendment : null;
  const amendmentEditable = amendment && ["draft", "returned"].includes(amendment.status);
  const amendmentPending = amendment?.status === "pending_approval";
  return {
    canRead,
    canEdit: Boolean(canCreate && ["draft", "returned"].includes(campaign.status)),
    canSubmit: Boolean(canCreate && ["draft", "returned"].includes(campaign.status)),
    canBeginAmendment: Boolean(canCreate && campaign.status === "published" && !amendment),
    canEditAmendment: Boolean(canCreate && amendmentEditable),
    canSubmitAmendment: Boolean(canCreate && amendmentEditable),
    canDiscardAmendment: Boolean(canCreate && amendment),
    canPublishAmendment: Boolean(canPublish && campaign.status === "published" && amendment?.status === "approved"),
    canPublish: Boolean(canPublish && campaign.status === "approved"),
    canStop: Boolean(canPublish && campaign.status === "published"),
    canCancel: Boolean(canCreate && ["draft", "returned", "approved"].includes(campaign.status)),
    canApprove: (campaign.status === "pending_approval" || amendmentPending) && review.canApprove,
    canReturn: (campaign.status === "pending_approval" || amendmentPending) && review.canApprove,
    alreadyActed: review.alreadyActed,
    isCreator,
  };
}
function presentWorkspaceCampaign(campaign = {}, approval = {}, rights = {}) {
  if (rights.canRead !== true) return null;
  const step = activeApprovalStep(approval);
  return {
    campaignId: String(campaign.campaignId || ""),
    revision: Number(campaign.revision || 0),
    status: String(campaign.status || ""),
    versionSequence: Number(campaign.versionSequence || 0),
    currentVersionId: String(campaign.currentVersionId || ""),
    releaseMode: String(campaign.releaseMode || ""),
    scheduledPublishAtText: String(campaign.scheduledPublishAtText || ""),
    createdBy: { roleId: campaign.createdBy?.roleId || "", accountId: campaign.createdBy?.accountId || "", name: campaign.createdBy?.name || "" },
    // The frontline version stays current while a private amendment is reviewed.
    draft: campaign.amendment?.draft || campaign.draft || null,
    amendment: campaign.amendment ? {
      status: String(campaign.amendment.status || ""),
      versionId: String(campaign.amendment.versionId || ""),
      baseVersionId: String(campaign.amendment.baseVersionId || ""),
      releaseMode: String(campaign.amendment.releaseMode || ""),
      scheduledPublishAtText: String(campaign.amendment.scheduledPublishAtText || ""),
    } : null,
    review: step ? {
      stepLabel: String(step.label || ""),
      stepIndex: Number(approval.currentStepIndex || 0),
      stepCount: Array.isArray(approval.steps) ? approval.steps.length : 0,
      quorum: String(step.quorum || ""),
      approvedCount: Object.values(approval.decisions || {}).filter((d) => d?.stepId === step.stepId && d?.decision === "approved").length,
      requiredCount: step.quorum === "all" ? (step.members || []).length : 1,
    } : null,
  };
}
module.exports = { actorId, sameActor, reviewerState, workspaceAccess, presentWorkspaceCampaign };

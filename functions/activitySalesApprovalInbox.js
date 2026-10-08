"use strict";
const crypto = require("crypto");

const identity = (x = {}) => ({
  roleId: String(x.actorRole || x.roleId || "").trim(),
  accountId: String(x.actorAccountId || x.accountId || "").trim(),
});
const equal = (a,b) => {
  const x=identity(a),y=identity(b);
  return Boolean(x.roleId && x.accountId && x.roleId===y.roleId && x.accountId===y.accountId);
};
const reviewerKey = (actor = {}) => {
  const x=identity(actor);
  if (!x.roleId || !x.accountId) return "";
  return crypto.createHash("sha256").update(`${x.roleId}\0${x.accountId}`).digest("hex").slice(0,24);
};
const activeStep = (a={}) => {
  const i=Number(a.currentStepIndex);
  if (a.status!=="pending" || !Number.isInteger(i) || i<0 || !Array.isArray(a.steps)) return null;
  return a.steps[i] || null;
};
function activeReviewerKeys(a={},getKey=reviewerKey) {
  const step=activeStep(a);
  if (!step) return [];
  const seen=new Set();
  const already=Object.values(a.decisions || {}).filter((d)=>d?.stepId===step.stepId).map((d)=>d.actor);
  for (const member of step.members || []) {
    if (a.allowCreatorApproval!==true && equal(member,a.creator)) continue;
    if (already.some((d)=>equal(member,d))) continue;
    const key=getKey(member);
    if (key) seen.add(key);
  }
  return [...seen];
}
function summarizeApprovalInbox(a={}, actor={}, brand="") {
  if (a.brandId!==brand || a.status!=="pending") return null;
  const id=String(a.campaignId || ""),versionId=String(a.versionId || "");
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(id) || !versionId.startsWith(`${id}_v`)) return null;
  const key=reviewerKey(actor);
  if (!key || !activeReviewerKeys(a).includes(key)) return null;
  const step=activeStep(a);
  if (!step) return null;
  return {
    campaignId:id,versionId,
    title:String(a.campaignTitle || "活動待審核").slice(0,160),
    stepLabel:String(step.label || "目前審核關卡").slice(0,120),
    quorum:step.quorum==="all"?"all":"any",
    stepIndex:Number(a.currentStepIndex),stepCount:a.steps.length,
    submittedAtText:String(a.createdAtText || "").slice(0,50),
  };
}
module.exports={reviewerKey,activeReviewerKeys,summarizeApprovalInbox};

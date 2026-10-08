import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require=createRequire(import.meta.url);
const {reviewerKey,activeReviewerKeys,summarizeApprovalInbox}=require("../functions/activitySalesApprovalInbox.js");
const anna={roleId:"director",accountId:"anna"},bob={roleId:"trainer",accountId:"bob"},creator={roleId:"trainer",accountId:"creator"};
const make=(quorum="all")=>({brandId:"cyj",campaignId:"fall",versionId:"fall_v001",campaignTitle:"秋季促銷",status:"pending",currentStepIndex:0,
  steps:[{stepId:"first",label:"第一關",quorum,members:[anna,bob]},{stepId:"second",label:"第二關",quorum:"any",members:[creator]}],
  decisions:{},creator,allowCreatorApproval:false,createdAtText:"2026-10-08T02:00:00.000Z"});

test("first active approval contains only currently authorized reviewers",()=>{
  const a=make();assert.deepEqual(activeReviewerKeys(a),[reviewerKey(anna),reviewerKey(bob)]);
  assert.equal(activeReviewerKeys(a).length,2);
});
test("all quorum partial decision removes only actor who already acted",()=>{
  const a=make();a.decisions[reviewerKey(anna)]={stepId:"first",decision:"approved",actor:anna};
  assert.deepEqual(activeReviewerKeys(a),[reviewerKey(bob)]);
  assert.equal(summarizeApprovalInbox(a,anna,"cyj"),null);
  assert.equal(summarizeApprovalInbox(a,bob,"cyj").stepLabel,"第一關");
});
test("transition to next step recalculates active reviewers, excluding prohibited creator",()=>{
  const a=make();a.currentStepIndex=1;
  assert.deepEqual(activeReviewerKeys(a),[]);
  a.allowCreatorApproval=true;
  assert.deepEqual(activeReviewerKeys(a),[reviewerKey(creator)]);
});
test("return and final approval clear inbox indexes",()=>{
  for (const status of ["returned","approved","cancelled"]) {
    const a=make();a.status=status;assert.deepEqual(activeReviewerKeys(a),[]);
  }
});
test("approver eligibility uses complete brand identity, not role title",()=>{
  const a=make();assert.equal(summarizeApprovalInbox(a,{...anna,accountId:"another"},"cyj"),null);
  assert.equal(summarizeApprovalInbox(a,anna,"anniu"),null);
  assert.equal(summarizeApprovalInbox(a,anna,"cyj").campaignId,"fall");
});
test("Inbox response excludes members, decisions, creator and full draft",()=>{
  const a=make();a.extraSensitive={credential:"private"};
  const item=summarizeApprovalInbox(a,anna,"cyj");
  assert.deepEqual(Object.keys(item).sort(),["campaignId","quorum","stepCount","stepIndex","stepLabel","submittedAtText","title","versionId"].sort());
  assert.equal(JSON.stringify(item).includes("private"),false);
});
test("corrupted approval identity or step state fail closed",()=>{
  const a=make();a.versionId="anniu_v001";assert.equal(summarizeApprovalInbox(a,anna,"cyj"),null);
  a.versionId="fall_v001";a.currentStepIndex=99;assert.deepEqual(activeReviewerKeys(a),[]);
  assert.equal(summarizeApprovalInbox(a,anna,"cyj"),null);
});

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { workspaceAccess, reviewerState, presentWorkspaceCampaign } = require("../functions/activitySalesWorkspaceAccess.js");
const alice={roleId:"trainer",accountId:"alice"};
const bob={roleId:"director",accountId:"bob"};
const other={roleId:"store",accountId:"other"};
const campaign={brandId:"cyj",campaignId:"a1",status:"pending_approval",revision:3,createdBy:alice,draft:{title:"private",approvalPlan:{mode:"all"}}};
const approval={status:"pending",currentStepIndex:0,steps:[{stepId:"s1",label:"審核一",quorum:"all",members:[bob,alice]}],decisions:{},creator:alice,allowCreatorApproval:false};
test("only creator, configured creator/publisher, or snapshotted current reviewer may read private campaign",()=>{
  assert.equal(workspaceAccess({actor:other,campaign,approval}).canRead,false);
  assert.equal(workspaceAccess({actor:alice,campaign,approval}).canRead,true);
  assert.equal(workspaceAccess({actor:alice,campaign,approval:{}}).canRead,false);
  assert.equal(workspaceAccess({actor:alice,campaign,approval:{},canCreate:true}).canRead,true);
  assert.equal(workspaceAccess({actor:bob,campaign,approval}).canRead,true);
  assert.equal(workspaceAccess({actor:other,campaign,approval,canPublish:true}).canRead,true);
});
test("reviewer self approval and repeat decision denied, but snapshot member remains eligible",()=>{
  assert.equal(reviewerState(approval,alice).canApprove,false);
  assert.equal(reviewerState(approval,bob).canApprove,true);
  const decided={...approval,decisions:{hash:{stepId:"s1",decision:"approved",actor:bob}}};
  assert.equal(reviewerState(decided,bob).canApprove,false);
  assert.equal(reviewerState(decided,other).canApprove,false);
  assert.equal(reviewerState({...approval,status:"approved"},bob).canApprove,false);
});
test("backend response emits no private policy, whole approval members or decision records",()=>{
  const rights=workspaceAccess({actor:bob,campaign,approval});
  const result=presentWorkspaceCampaign(campaign,approval,rights);
  assert.equal(result.draft.title,"private");
  assert.equal(result.review.requiredCount,2);
  assert.equal(result.review.approvedCount,0);
  assert.equal(result.review.members,undefined);
  assert.equal(result.approval,undefined);
  assert.equal(result.audit,undefined);
  assert.equal(presentWorkspaceCampaign(campaign,approval,{canRead:false}),null);
});
test("OCC writers unchanged, workspace endpoint is a single-document, trusted backend reader",()=>{
  const src=fs.readFileSync("functions/activitySalesAuthority.js","utf8");
  const index=fs.readFileSync("functions/index.js","utf8");
  const runtime=fs.readFileSync("src/config/runtimeEnvironment.js","utf8");
  const rules=fs.readFileSync("firestore.rules","utf8");
  assert.match(src,/getActivitySalesWorkspace=onRequest/);
  assert.match(src,/const checked=await verifiedActor\(req,brand,body\.actor/);
  assert.match(src,/const policySnap=await tx\.get\(policyRef\(brand\)\)/);
  assert.match(src,/const snap=await tx\.get\(campaignRef\(brand,id\)\)/);
  assert.match(src,/tx\.get\(approvalRef\(brand,versionId\)\)/);
  assert.doesNotMatch(src,/activity_campaigns"\)\.get\(\)/);
  assert.match(index,/exports\.getActivitySalesWorkspace/);
  assert.match(runtime,/getActivitySalesWorkspace/);
  for (const c of ["activity_campaigns","activity_campaign_versions","activity_campaign_approvals","activity_sales_policy"]) {
    assert.match(rules,new RegExp(`match /brands/\\{brandId\\}/${c}/\\{document=\\*\\*\\} \\{ allow read, write: if false; \\}`));
  }
});

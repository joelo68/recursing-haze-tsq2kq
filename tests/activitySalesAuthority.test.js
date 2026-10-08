import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  normalizePolicy, selectorsAllow, normalizeApprovalPlan, resolveApprovalSteps,
  validateCreatorApprovalPlan, normalizeCampaignDraft, approvedStatus,
} = require("../functions/activitySalesAuthority.js");

const acct=(roleId,accountId,name=accountId)=>({roleId,accountId,name});

test("activity creator/publisher rights are configurable people/groups, not fixed jobs",()=>{
  const p=normalizePolicy({
    groups:{campaign_team:{label:"活動小組",members:[acct("trainer","t1"),acct("director","d1")]}},
    creatorSelectors:[{type:"group",groupId:"campaign_team"}],
    directPublishSelectors:[{type:"account",...acct("director","d1")}],
    publisherSelectors:[{type:"group",groupId:"campaign_team"}],
  });
  assert.equal(selectorsAllow(p.creatorSelectors,p.groups,{actorRole:"trainer",actorAccountId:"t1"}),true);
  assert.equal(selectorsAllow(p.creatorSelectors,p.groups,{actorRole:"store",actorAccountId:"s1"}),false);
});

test("approval is selectable and creator self-approval is explicit",()=>{
  const none=normalizeApprovalPlan({mode:"none",releaseMode:"immediate_after_approval",allowCreatorApproval:true});
  assert.equal(none.mode,"none"); assert.equal(none.steps.length,0); assert.equal(none.allowCreatorApproval,true);
  const custom=normalizeApprovalPlan({
    mode:"custom",releaseMode:"manual_after_approval",allowCreatorApproval:false,
    steps:[
      {stepId:"commercial",quorum:"any",selectors:[{type:"group",groupId:"g"}]},
      {stepId:"final",quorum:"all",selectors:[{type:"account",...acct("director","d2")}]},
    ],
  });
  assert.equal(custom.steps.length,2); assert.equal(custom.steps[1].quorum,"all");
});

test("approval groups resolve to concrete people at submit time",()=>{
  const p=normalizePolicy({groups:{g:{members:[acct("trainer","a1"),acct("director","a2")]}}});
  const steps=resolveApprovalSteps({mode:"sequential",steps:[{stepId:"s1",quorum:"all",selectors:[{type:"group",groupId:"g"}]}]},p.groups);
  assert.deepEqual(steps[0].members.map(x=>x.accountId),["a1","a2"]);
});

test("official price must equal internal attribution total",()=>{
  const base={title:"10月活動",startDate:"2026-10-01",endDate:"2026-10-31",
    packages:[{packageId:"a",name:"A組",salePrice:18800,items:[
      {itemId:"course",name:"課程",quantity:1,attributedAmount:14000},
      {itemId:"product",name:"商品",quantity:1,attributedAmount:4800},
    ]}],approvalPlan:{mode:"none",releaseMode:"manual_after_approval"}};
  assert.equal(normalizeCampaignDraft(base).packages[0].salePrice,18800);
  assert.throws(()=>normalizeCampaignDraft({...base,packages:[{...base.packages[0],items:[{itemId:"course",name:"課程",quantity:1,attributedAmount:14000}]}]}),/內部歸屬合計必須等於正式售價/);
});

test("approval release mode controls approved vs published",()=>{
  assert.equal(approvedStatus({mode:"none",releaseMode:"manual_after_approval"}),"approved");
  assert.equal(approvedStatus({mode:"none",releaseMode:"immediate_after_approval"}),"published");
});



test("scheduled release is fail-closed until the scheduled time",()=>{
  assert.throws(
    ()=>normalizeApprovalPlan({mode:"none",releaseMode:"scheduled_after_approval"}),
    /排程發布需要有效的發布時間/
  );
  const scheduled=normalizeApprovalPlan({
    mode:"none",
    releaseMode:"scheduled_after_approval",
    scheduledPublishAt:"2026-10-08T10:00:00+08:00",
  });
  assert.equal(scheduled.scheduledPublishAt,"2026-10-08T02:00:00.000Z");
  assert.equal(approvedStatus(scheduled),"approved");
  assert.equal(approvedStatus({mode:"none",releaseMode:"immediate_after_approval"}),"published");
});

test("creator self-approval=false rejects impossible all-quorum steps",()=>{
  const creator=acct("director","d1");
  const p=normalizePolicy({groups:{g:{members:[creator,acct("trainer","t1")]}}});
  const allSteps=resolveApprovalSteps({
    mode:"sequential",
    steps:[{stepId:"s1",quorum:"all",selectors:[{type:"group",groupId:"g"}]}],
  },p.groups);
  assert.throws(
    ()=>validateCreatorApprovalPlan(allSteps,creator,false),
    /與建立者不可自行核准的設定衝突/
  );

  const anySteps=resolveApprovalSteps({
    mode:"sequential",
    steps:[{stepId:"s1",quorum:"any",selectors:[{type:"group",groupId:"g"}]}],
  },p.groups);
  assert.equal(validateCreatorApprovalPlan(anySteps,creator,false),true);
});

test("campaign mutations read current policy inside the Firestore transaction",()=>{
  const authority=fs.readFileSync("functions/activitySalesAuthority.js","utf8");
  assert.match(authority,/const policySnap=await tx\.get\(policyRef\(brand\)\)/);
  assert.match(authority,/policyRevision:policy\?\.revision \?\? null/);
});

test("Phase1A wires backend-only collections and dev route guards",()=>{
  const index=fs.readFileSync("functions/index.js","utf8");
  const rules=fs.readFileSync("firestore.rules","utf8");
  const runtime=fs.readFileSync("src/config/runtimeEnvironment.js","utf8");
  assert.match(index,/exports\.manageActivitySalesPolicy/);
  assert.match(index,/exports\.manageActivityCampaign/);
  for (const c of ["activity_sales_policy","activity_campaigns","activity_campaign_versions","activity_campaign_approvals","activity_sales_audit"]) {
    assert.match(rules,new RegExp(`collectionName != '${c}'`));
  }
  assert.match(runtime,/manageActivitySalesPolicy/); assert.match(runtime,/manageActivityCampaign/);
});


test("Phase 1C-3 requires an explicit timezone and rejects schedule after activity end",()=>{
  assert.throws(()=>normalizeApprovalPlan({
    mode:"none",releaseMode:"scheduled_after_approval",
    scheduledPublishAt:"2026-10-08T10:00:00",
  }),/排程發布需要有效的發布時間/);
  const draft={title:"排程活動",startDate:"2026-10-01",endDate:"2026-10-08",
    packages:[{packageId:"p1",name:"一組",salePrice:980,items:[
      {itemId:"c1",name:"課程",quantity:1,attributedAmount:980},
    ]}],approvalPlan:{mode:"none",releaseMode:"scheduled_after_approval",
      scheduledPublishAt:"2026-10-09T01:00:00+08:00"}};
  assert.throws(()=>normalizeCampaignDraft(draft),/排程發布時間不可晚於活動結束日期/);
  assert.equal(normalizeCampaignDraft({
    ...draft,approvalPlan:{...draft.approvalPlan,
      scheduledPublishAt:"2026-10-08T10:00:00+08:00"},
  }).approvalPlan.scheduledPublishAt,"2026-10-08T02:00:00.000Z");
});

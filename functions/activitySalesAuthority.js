const crypto = require("crypto");
const { onRequest } = require("firebase-functions/v2/https");
const { buildActivitySalesPublication } = require("./activitySalesPublishedProjection");
const { assertActivitySalesSessionActor } = require("./activitySalesSessionBoundary");
const { workspaceAccess, presentWorkspaceCampaign } = require("./activitySalesWorkspaceAccess");
const { activeReviewerKeys, summarizeApprovalInbox } = require("./activitySalesApprovalInbox");
const {
  getBrandCollection,
  requireFirebaseRequestAuth,
  verifySuperAdminActor,
  verifyTrustedApplicationActor,
} = require("./deviceApproval");

const ACTIVITY_SALES_SCHEMA_VERSION = "activity-sales-v1";
const POLICY_SCHEMA_VERSION = "activity-sales-policy-v1";
const VERSION_SCHEMA_VERSION = "activity-campaign-version-v1";

const APPROVAL_MODES = new Set(["none", "any", "all", "sequential", "custom"]);
const RELEASE_MODES = new Set(["immediate_after_approval", "scheduled_after_approval", "manual_after_approval"]);
const QUORUMS = new Set(["any", "all"]);

class ActivitySalesError extends Error {
  constructor(code, status = 400, message = code, details = {}) {
    super(message); this.code = code; this.status = status; this.details = details;
  }
}

const text = (value = "", max = 240) => String(value ?? "").trim().slice(0, max);
const stableId = (value = "", max = 80) => {
  const v = text(value, max);
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(v) ? v : "";
};
const brandId = (value = "") => {
  const v = text(value, 24).toLowerCase();
  if (["default","default-app-id","drcyj","cyj"].includes(v)) return "cyj";
  if (["anniu","anew","安妞"].includes(v)) return "anniu";
  if (["yibo","伊啵"].includes(v)) return "yibo";
  return "";
};
const isoDate = (value = "") => {
  const v = text(value, 10).replace(/\//g, "-");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return "";
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0,10) === v ? v : "";
};
const isoTimestamp = (value = "") => {
  const v = text(value, 80);
  if (!v) return "";
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : "";
};
const revision = (value) => {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw new ActivitySalesError("REVISION_INVALID",400,"活動版本已失效，請重新載入");
  return n;
};
const money = (value, allowNull = false) => {
  if (allowNull && (value === null || value === undefined || value === "")) return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 100000000) throw new ActivitySalesError("MONEY_INVALID",400,"活動金額格式錯誤");
  return n;
};

function normalizeIdentity(raw = {}) {
  const roleId = stableId(raw.roleId, 40);
  const accountId = text(raw.accountId, 160);
  if (!roleId || !accountId) throw new ActivitySalesError("IDENTITY_INVALID",400,"活動權限人員資料不完整");
  return { roleId, accountId, name: text(raw.name || raw.userName || accountId,120) };
}
function sameIdentity(a = {}, b = {}) {
  return text(a.roleId,40) === text(b.roleId,40) && text(a.accountId,160) === text(b.accountId,160);
}
function decisionKey(identity = {}) {
  return crypto.createHash("sha256")
    .update(`${text(identity.roleId,40)}\0${text(identity.accountId,160)}`)
    .digest("hex").slice(0,24);
}
function normalizeSelector(raw = {}) {
  const type = text(raw.type,20).toLowerCase();
  if (type === "account") return { type, account: normalizeIdentity(raw.account || raw) };
  if (type === "group") {
    const groupId = stableId(raw.groupId);
    if (!groupId) throw new ActivitySalesError("GROUP_INVALID",400,"活動權限群組格式錯誤");
    return { type, groupId };
  }
  throw new ActivitySalesError("SELECTOR_INVALID",400,"活動權限選擇方式不支援");
}
function normalizeSelectors(values = []) {
  if (!Array.isArray(values) || values.length > 100) throw new ActivitySalesError("SELECTORS_INVALID",400,"活動權限選擇數量過多");
  return values.map(normalizeSelector);
}
function normalizeGroups(raw = {}) {
  const src = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  if (Object.keys(src).length > 60) throw new ActivitySalesError("GROUPS_TOO_LARGE",400,"活動權限群組數量過多");
  const out = {};
  for (const [key,val] of Object.entries(src)) {
    const id = stableId(key);
    const membersRaw = Array.isArray(val?.members) ? val.members : [];
    if (!id || !membersRaw.length || membersRaw.length > 100) throw new ActivitySalesError("GROUP_INVALID",400,"活動權限群組資料錯誤");
    const seen = new Set();
    const members = [];
    for (const rawMember of membersRaw) {
      const member = normalizeIdentity(rawMember);
      const k = `${member.roleId}\0${member.accountId}`;
      if (!seen.has(k)) { seen.add(k); members.push(member); }
    }
    out[id] = { groupId:id, label:text(val?.label || id,120), members };
  }
  return out;
}
function normalizePolicy(raw = {}) {
  return {
    schemaVersion: POLICY_SCHEMA_VERSION,
    revision: Math.max(0, Number(raw.revision || 0)),
    groups: normalizeGroups(raw.groups || {}),
    creatorSelectors: normalizeSelectors(raw.creatorSelectors || []),
    directPublishSelectors: normalizeSelectors(raw.directPublishSelectors || []),
    publisherSelectors: normalizeSelectors(raw.publisherSelectors || []),
  };
}
function expandSelectors(selectors = [], groups = {}) {
  const result=[]; const seen=new Set();
  for (const selector of normalizeSelectors(selectors)) {
    const candidates = selector.type === "account" ? [selector.account] : (groups?.[selector.groupId]?.members || []);
    for (const raw of candidates) {
      const item = normalizeIdentity(raw);
      const key = `${item.roleId}\0${item.accountId}`;
      if (!seen.has(key)) { seen.add(key); result.push(item); }
    }
  }
  return result;
}
function selectorsAllow(selectors = [], groups = {}, actor = {}) {
  const identity = normalizeIdentity({
    roleId: actor.actorRole || actor.roleId,
    accountId: actor.actorAccountId || actor.accountId,
    name: actor.actorName || actor.name,
  });
  return expandSelectors(selectors, groups).some((item) => sameIdentity(item, identity));
}

function normalizeApprovalPlan(raw = {}) {
  const requestedMode = text(raw.mode,32).toLowerCase();
  const mode = APPROVAL_MODES.has(requestedMode) ? requestedMode : "none";
  const requestedRelease = text(raw.releaseMode,40).toLowerCase();
  const releaseMode = RELEASE_MODES.has(requestedRelease) ? requestedRelease : "manual_after_approval";
  const scheduledPublishAt = releaseMode === "scheduled_after_approval"
    ? isoTimestamp(raw.scheduledPublishAt || raw.publishAt)
    : "";
  if (releaseMode === "scheduled_after_approval" && !scheduledPublishAt) {
    throw new ActivitySalesError("SCHEDULE_REQUIRED",400,"排程發布需要有效的發布時間");
  }
  const allowCreatorApproval = raw.allowCreatorApproval === true;
  let steps = [];
  if (mode === "any" || mode === "all") {
    const selectors = normalizeSelectors(raw.selectors || []);
    if (!selectors.length) throw new ActivitySalesError("APPROVER_REQUIRED",400,"此活動需要指定核准人員");
    steps=[{stepId:"approval",label:text(raw.label || "活動核准",120),quorum:mode,selectors}];
  } else if (mode === "sequential" || mode === "custom") {
    const source = Array.isArray(raw.steps) ? raw.steps : [];
    if (!source.length || source.length > 12) throw new ActivitySalesError("APPROVAL_STEPS_INVALID",400,"活動審核流程步驟數量錯誤");
    steps=source.map((step,i)=>{
      const stepId=stableId(step.stepId || `step_${i+1}`);
      const selectors=normalizeSelectors(step.selectors || []);
      const quorum=QUORUMS.has(text(step.quorum,20).toLowerCase()) ? text(step.quorum,20).toLowerCase() : "any";
      if (!stepId || !selectors.length) throw new ActivitySalesError("APPROVAL_STEP_INVALID",400,"活動審核步驟需要指定核准人員");
      return {stepId,label:text(step.label || `審核 ${i+1}`,120),quorum,selectors};
    });
  }
  return { mode, releaseMode, scheduledPublishAt, allowCreatorApproval, steps };
}
function resolveApprovalSteps(plan = {}, groups = {}) {
  return normalizeApprovalPlan(plan).steps.map((step)=>{
    const members=expandSelectors(step.selectors,groups);
    if (!members.length) throw new ActivitySalesError("APPROVAL_GROUP_EMPTY",400,`審核步驟「${step.label}」沒有可核准人員`);
    return {stepId:step.stepId,label:step.label,quorum:step.quorum,members};
  });
}
function actorInStep(step = {}, actor = {}) {
  const id={roleId:actor.actorRole || actor.roleId, accountId:actor.actorAccountId || actor.accountId};
  return (step.members || []).some((member)=>sameIdentity(member,id));
}
function validateCreatorApprovalPlan(steps = [], creator = {}, allowCreatorApproval = false) {
  if (allowCreatorApproval === true) return true;
  for (const step of steps) {
    const members = Array.isArray(step?.members) ? step.members : [];
    const creatorIncluded = members.some((member)=>sameIdentity(member,creator));
    const nonCreatorExists = members.some((member)=>!sameIdentity(member,creator));
    if ((step?.quorum === "all" && creatorIncluded) || (step?.quorum !== "all" && !nonCreatorExists)) {
      throw new ActivitySalesError(
        "CREATOR_APPROVAL_CONFLICT",
        400,
        `審核步驟「${text(step?.label || step?.stepId || "活動核准",120)}」與建立者不可自行核准的設定衝突`
      );
    }
  }
  return true;
}
function normalizeList(values,maxItems=100,maxLength=120) {
  if (!Array.isArray(values) || values.length > maxItems) throw new ActivitySalesError("LIST_INVALID",400,"活動資料項目過多");
  return [...new Set(values.map((v)=>text(v,maxLength)).filter(Boolean))];
}
function normalizePackage(raw = {}, index = 0) {
  const packageId=stableId(raw.packageId || `package_${index+1}`);
  const name=text(raw.name,160);
  const salePrice=money(raw.salePrice);
  const originalPrice=money(raw.originalPrice,true);
  const source=Array.isArray(raw.items) ? raw.items : [];
  if (!packageId || !name || !source.length || source.length > 80) throw new ActivitySalesError("PACKAGE_INVALID",400,"活動套組資料不完整");
  const items=source.map((item,i)=>{
    const itemId=stableId(item.itemId || item.code || `item_${i+1}`);
    const itemName=text(item.name,160);
    const quantity=Number(item.quantity ?? 1);
    if (!itemId || !itemName || !Number.isInteger(quantity) || quantity <= 0 || quantity > 999) throw new ActivitySalesError("PACKAGE_ITEM_INVALID",400,"活動套組內容格式錯誤");
    return {itemId,type:text(item.type || "other",24),name:itemName,quantity,attributedAmount:money(item.attributedAmount ?? 0)};
  });
  if (items.reduce((sum,item)=>sum+item.attributedAmount,0) !== salePrice) {
    throw new ActivitySalesError("SPLIT_MISMATCH",400,`活動套組「${name}」的內部歸屬合計必須等於正式售價`);
  }
  return {packageId,name,salePrice,originalPrice,items};
}
function normalizeCampaignDraft(raw = {}) {
  const title=text(raw.title,160);
  const startDate=isoDate(raw.startDate);
  const endDate=isoDate(raw.endDate);
  if (!title || !startDate || !endDate || startDate > endDate) throw new ActivitySalesError("CAMPAIGN_INVALID",400,"活動名稱或期間不完整");
  const packages=Array.isArray(raw.packages) ? raw.packages : [];
  if (!packages.length || packages.length > 40) throw new ActivitySalesError("PACKAGES_REQUIRED",400,"活動至少需要一個正式銷售套組");
  const storeScope=text(raw.storeScope,24)==="selected" ? "selected" : "all";
  const stores=storeScope==="selected" ? normalizeList(raw.stores || [],250,120) : [];
  if (storeScope==="selected" && !stores.length) throw new ActivitySalesError("STORES_REQUIRED",400,"指定門市活動至少需要一間門市");
  return {
    title, shortSummary:text(raw.shortSummary,360), startDate,endDate,storeScope,stores,
    customerTypes:normalizeList(raw.customerTypes || [],40,80),
    tags:normalizeList(raw.tags || [],60,80),
    sellingPoints:normalizeList(raw.sellingPoints || [],20,240),
    suitableFor:normalizeList(raw.suitableFor || [],30,200),
    notSuitableFor:normalizeList(raw.notSuitableFor || [],30,200),
    discountRules:normalizeList(raw.discountRules || [],40,240),
    restrictions:normalizeList(raw.restrictions || [],40,240),
    salesTalk:text(raw.salesTalk,2400),
    packages:packages.map(normalizePackage),
    faq:(Array.isArray(raw.faq)?raw.faq:[]).slice(0,80).map((f,i)=>({faqId:stableId(f.faqId || `faq_${i+1}`),question:text(f.question,240),answer:text(f.answer,1200)})).filter((f)=>f.faqId&&f.question&&f.answer),
    approvalPlan:normalizeApprovalPlan(raw.approvalPlan || {}),
  };
}
function approvedStatus(plan = {}) {
  return normalizeApprovalPlan(plan).releaseMode === "immediate_after_approval" ? "published" : "approved";
}
function actorSnapshot(check = {}) {
  return {roleId:text(check.actorRole,40),accountId:text(check.actorAccountId,160),name:text(check.actorName,120)};
}


function createActivitySalesAuthorityFunctions({admin,db}) {
  const col=(brand,name)=>getBrandCollection(db,brand,name);
  const policyRef=(brand)=>col(brand,"activity_sales_policy").doc("current");
  const campaignRef=(brand,id)=>col(brand,"activity_campaigns").doc(id);
  const versionRef=(brand,id)=>col(brand,"activity_campaign_versions").doc(id);
  const approvalRef=(brand,id)=>col(brand,"activity_campaign_approvals").doc(id);
  const auditRef=(brand)=>col(brand,"activity_sales_audit").doc();
  const publishedRef=(brand,id)=>col(brand,"activity_sales_publications").doc(id);

  async function verifiedActor(req,brand,rawActor) {
    const auth=await requireFirebaseRequestAuth(req,admin);
    if (!auth.ok) throw new ActivitySalesError("AUTH_EXPIRED",401,"登入狀態已失效，請重新登入");
    assertActivitySalesSessionActor(auth,brand,rawActor || {});
    const checked=await verifyTrustedApplicationActor({db,brandId:brand,actor:rawActor || {},allowedRoles:[]});
    if (!checked.ok) throw new ActivitySalesError("ACTOR_NOT_TRUSTED",403,"此操作需要已信任裝置與目前帳號驗證");
    return checked;
  }
  // Read-only management gateway: single campaign, capped reviewer Inbox, or super-admin Policy.
  // Browser Rules still deny all private Activity Sales collections.
  const getActivitySalesWorkspace=onRequest({cors:true,timeoutSeconds:20,memory:"256MiB"},async(req,res)=>{
    if (req.method!=="POST") return res.status(405).json({ok:false,message:"method_not_allowed"});
    try {
      const body=req.body || {}; const brand=brandId(body.brandId);
      if (!brand) throw new ActivitySalesError("BRAND_INVALID",400,"不支援的品牌");
      const checked=await verifiedActor(req,brand,body.actor || {});
      const actor=actorSnapshot(checked);
      const action=text(body.action,40).toLowerCase();
      if (!["capabilities","get_campaign","approval_inbox","get_policy"].includes(action)) {
        throw new ActivitySalesError("WORKSPACE_ACTION_INVALID",400,"不支援的管理資料讀取操作");
      }
      // Private policy membership is disclosed only to a fresh verified super-admin.
      // No browser Firestore permission is granted by this read endpoint.
      if (action==="get_policy") {
        const superAdmin=await verifySuperAdminActor({db,brandId:brand,actor:body.actor || {}});
        if (!superAdmin.ok) throw new ActivitySalesError("POLICY_FORBIDDEN",403,"只有最高管理者可讀取活動權限設定");
        const snap=await policyRef(brand).get();
        return res.status(200).json({ok:true,policy:normalizePolicy(snap.exists ? snap.data() || {} : {}),policyReady:snap.exists});
      }
      if (action==="approval_inbox") {
        // Single brand-scoped, one-shot array-contains query: max 20 reads/request.
        // The reviewer key is derived from the verified identity, NEVER from a client-supplied key.
        const key=decisionKey(actor);
        const snaps=await col(brand,"activity_campaign_approvals")
          .where("activeReviewerKeys","array-contains",key).limit(20).get();
        const items=snaps.docs.map((doc)=>summarizeApprovalInbox(doc.data() || {},actor,brand)).filter(Boolean);
        return res.status(200).json({ok:true,inbox:items,limit:20,hasMore:snaps.size===20});
      }
      // Snapshot-consistent read-only transaction: a concurrent policy revision
      // cannot be mixed with a different campaign/approval state.
      const result=await db.runTransaction(async(tx)=>{
        const policySnap=await tx.get(policyRef(brand));
        const policy=policySnap.exists ? normalizePolicy(policySnap.data() || {}) : null;
        const canCreate=Boolean(policy && selectorsAllow(policy.creatorSelectors,policy.groups,checked));
        const canPublish=Boolean(policy && selectorsAllow(policy.publisherSelectors,policy.groups,checked));
        const canDirectPublish=Boolean(policy && selectorsAllow(policy.directPublishSelectors,policy.groups,checked));
        const capabilities={policyReady:Boolean(policy),canCreate,canPublish,canDirectPublish,
          // Group labels only: never expose member lists or sensitive policy authority.
          groups:canCreate ? Object.values(policy.groups).map((g)=>({groupId:g.groupId,label:g.label})) : []};
        if (action==="capabilities") return {capabilities};

        const id=stableId(body.campaignId);
        if (!id) throw new ActivitySalesError("CAMPAIGN_ID_INVALID",400,"請輸入有效的活動代碼");
        const snap=await tx.get(campaignRef(brand,id));
        if (!snap.exists) throw new ActivitySalesError("CAMPAIGN_NOT_FOUND",404,"找不到此活動代碼");
        const campaign=snap.data() || {};
        if (campaign.brandId!==brand || campaign.campaignId!==id) {
          throw new ActivitySalesError("CAMPAIGN_IDENTITY_MISMATCH",409,"活動資料識別不一致，已停止讀取");
        }
        let approval={};
        if (campaign.status==="pending_approval") {
          const versionId=stableId(campaign.currentVersionId);
          if (!versionId || !versionId.startsWith(`${id}_v`)) {
            throw new ActivitySalesError("VERSION_IDENTITY_INVALID",409,"活動審核版本識別錯誤");
          }
          const approvalSnap=await tx.get(approvalRef(brand,versionId));
          if (!approvalSnap.exists) throw new ActivitySalesError("APPROVAL_STATE_MISSING",409,"此活動審核資料遺失");
          approval=approvalSnap.data() || {};
          if (approval.brandId!==brand || approval.campaignId!==id || approval.versionId!==versionId) {
            throw new ActivitySalesError("APPROVAL_IDENTITY_MISMATCH",409,"活動審核識別不一致，已停止讀取");
          }
        }
        const rights=workspaceAccess({actor,campaign,approval,canCreate,canPublish});
        if (!rights.canRead) throw new ActivitySalesError("WORKSPACE_FORBIDDEN",403,"目前帳號沒有查看此活動草稿的權限");
        return {campaign:presentWorkspaceCampaign(
          {...campaign,draft:normalizeCampaignDraft(campaign.draft || {})},approval,rights),
          capabilities:{...capabilities,...rights}};
      });
      return res.status(200).json({ok:true,...result});
    } catch(error) {
      const status=Number(error?.status || 500);
      if (status>=500) console.error("getActivitySalesWorkspace failed",error);
      return res.status(status).json({ok:false,code:error?.code || "WORKSPACE_FAILED",message:error?.message || "目前無法讀取活動管理資料"});
    }
  });

  const manageActivitySalesPolicy=onRequest({cors:true,timeoutSeconds:30,memory:"256MiB"},async(req,res)=>{
    if (req.method!=="POST") return res.status(405).json({ok:false,message:"method_not_allowed"});
    try {
      const body=req.body || {}; const brand=brandId(body.brandId);
      if (!brand) throw new ActivitySalesError("BRAND_INVALID",400,"不支援的品牌");
      const auth=await requireFirebaseRequestAuth(req,admin);
      if (!auth.ok) throw new ActivitySalesError("AUTH_EXPIRED",401,"登入狀態已失效，請重新登入");
      assertActivitySalesSessionActor(auth,brand,body.actor || {});
      const adminCheck=await verifySuperAdminActor({db,brandId:brand,actor:body.actor || {}});
      if (!adminCheck.ok) throw new ActivitySalesError("POLICY_FORBIDDEN",403,"活動權限設定僅限已信任裝置上的最高管理者修改");
      const expected=revision(body.expectedRevision); const normalized=normalizePolicy(body.policy || {});
      const ref=policyRef(brand); const logRef=auditRef(brand); let result;
      await db.runTransaction(async(tx)=>{
        const snap=await tx.get(ref); const current=snap.exists ? Number(snap.data()?.revision || 0) : 0;
        if (current!==expected) throw new ActivitySalesError("POLICY_CONFLICT",409,"活動權限設定已由其他管理者更新，請重新載入");
        const next=current+1; const now=new Date().toISOString();
        result={...normalized,revision:next,updatedAt:admin.firestore.FieldValue.serverTimestamp(),updatedAtText:now,updatedBy:actorSnapshot(adminCheck)};
        tx.set(ref,result,{merge:false});
        tx.set(logRef,{schemaVersion:ACTIVITY_SALES_SCHEMA_VERSION,type:"policy",action:"update",brandId:brand,revision:next,actor:actorSnapshot(adminCheck),createdAt:admin.firestore.FieldValue.serverTimestamp(),createdAtText:now},{merge:false});
      });
      return res.status(200).json({ok:true,policy:result});
    } catch(error) {
      const status=Number(error?.status || 500);
      if (status>=500) console.error("manageActivitySalesPolicy failed",error);
      return res.status(status).json({ok:false,code:error?.code || "POLICY_FAILED",message:error?.message || "活動權限設定目前無法更新"});
    }
  });

  const manageActivityCampaign=onRequest({cors:true,timeoutSeconds:30,memory:"256MiB"},async(req,res)=>{
    if (req.method!=="POST") return res.status(405).json({ok:false,message:"method_not_allowed"});
    try {
      const body=req.body || {}; const brand=brandId(body.brandId);
      if (!brand) throw new ActivitySalesError("BRAND_INVALID",400,"不支援的品牌");
      const actorCheck=await verifiedActor(req,brand,body.actor || {});
      const actor=actorSnapshot(actorCheck);
      const action=text(body.action,40).toLowerCase();

      if (action==="create_draft") {
        const draft=normalizeCampaignDraft(body.campaign || {});
        const generated=col(brand,"activity_campaigns").doc();
        const id=stableId(body.campaignId || generated.id);
        if (!id) throw new ActivitySalesError("CAMPAIGN_ID_INVALID",400,"活動代碼格式錯誤");
        const ref=campaignRef(brand,id); const log=auditRef(brand); const now=new Date().toISOString();
        const payload={schemaVersion:ACTIVITY_SALES_SCHEMA_VERSION,brandId:brand,campaignId:id,revision:1,versionSequence:0,status:"draft",draft,createdAt:admin.firestore.FieldValue.serverTimestamp(),createdAtText:now,createdBy:actor,updatedAt:admin.firestore.FieldValue.serverTimestamp(),updatedAtText:now,updatedBy:actor};
        await db.runTransaction(async(tx)=>{
          const policySnap=await tx.get(policyRef(brand));
          const existingSnap=await tx.get(ref);
          if (!policySnap.exists) throw new ActivitySalesError("POLICY_MISSING",409,"尚未設定活動銷售中心權限");
          const policy=normalizePolicy(policySnap.data() || {});
          const canCreate=selectorsAllow(policy.creatorSelectors,policy.groups,actorCheck);
          const canDirect=selectorsAllow(policy.directPublishSelectors,policy.groups,actorCheck);
          if (!canCreate) throw new ActivitySalesError("CREATE_FORBIDDEN",403,"目前帳號沒有建立活動的權限");
          if (draft.approvalPlan.mode==="none" && !canDirect) throw new ActivitySalesError("DIRECT_PUBLISH_FORBIDDEN",403,"目前帳號不能設定免審核直接發布");
          if (existingSnap.exists) throw new ActivitySalesError("CAMPAIGN_EXISTS",409,"活動代碼已存在");
          tx.set(ref,payload,{merge:false});
          tx.set(log,{schemaVersion:ACTIVITY_SALES_SCHEMA_VERSION,type:"campaign",action,brandId:brand,campaignId:id,revision:1,policyRevision:policy.revision,actor,createdAt:admin.firestore.FieldValue.serverTimestamp(),createdAtText:now},{merge:false});
        });
        return res.status(200).json({ok:true,campaign:payload});
      }

      const id=stableId(body.campaignId); if (!id) throw new ActivitySalesError("CAMPAIGN_ID_INVALID",400,"缺少活動代碼");
      const expected=revision(body.expectedRevision); const ref=campaignRef(brand,id); const log=auditRef(brand); let output;
      await db.runTransaction(async(tx)=>{
        const snap=await tx.get(ref); if (!snap.exists) throw new ActivitySalesError("CAMPAIGN_NOT_FOUND",404,"找不到活動");
        const current=snap.data() || {}; const currentRev=Number(current.revision || 0);
        if (currentRev!==expected) throw new ActivitySalesError("CAMPAIGN_CONFLICT",409,"活動已由其他人更新，請重新載入",{currentRevision:currentRev});

        const policyGatedAction=["update_draft","submit_for_approval","publish","stop","cancel"].includes(action);
        let policy=null; let canCreate=false; let canDirect=false; let canPublish=false;
        if (policyGatedAction) {
          const policySnap=await tx.get(policyRef(brand));
          if (!policySnap.exists) throw new ActivitySalesError("POLICY_MISSING",409,"尚未設定活動銷售中心權限");
          policy=normalizePolicy(policySnap.data() || {});
          canCreate=selectorsAllow(policy.creatorSelectors,policy.groups,actorCheck);
          canDirect=selectorsAllow(policy.directPublishSelectors,policy.groups,actorCheck);
          canPublish=selectorsAllow(policy.publisherSelectors,policy.groups,actorCheck);
        }

        const next=currentRev+1; const now=new Date().toISOString();
        const baseAudit={schemaVersion:ACTIVITY_SALES_SCHEMA_VERSION,type:"campaign",action,brandId:brand,campaignId:id,fromStatus:current.status,policyRevision:policy?.revision ?? null,actor,createdAt:admin.firestore.FieldValue.serverTimestamp(),createdAtText:now};

        if (action==="update_draft") {
          if (!canCreate || !["draft","returned"].includes(current.status)) throw new ActivitySalesError("EDIT_FORBIDDEN",403,"目前狀態或帳號不可修改此活動");
          const draft=normalizeCampaignDraft(body.campaign || {});
          if (draft.approvalPlan.mode==="none" && !canDirect) throw new ActivitySalesError("DIRECT_PUBLISH_FORBIDDEN",403,"目前帳號不能設定免審核直接發布");
          tx.set(ref,{revision:next,status:"draft",draft,updatedAt:admin.firestore.FieldValue.serverTimestamp(),updatedAtText:now,updatedBy:actor},{merge:true});
          tx.set(log,{...baseAudit,toStatus:"draft",revision:next},{merge:false});
          output={status:"draft",revision:next}; return;
        }

        if (action==="submit_for_approval") {
          if (!canCreate || !["draft","returned"].includes(current.status)) throw new ActivitySalesError("SUBMIT_FORBIDDEN",403,"目前狀態或帳號不可送出此活動");
          const draft=normalizeCampaignDraft(current.draft || {});
          if (draft.approvalPlan.mode==="none" && !canDirect) throw new ActivitySalesError("DIRECT_PUBLISH_FORBIDDEN",403,"目前帳號不能免審核直接發布");
          const seq=Number(current.versionSequence || 0)+1;
          const versionId=`${id}_v${String(seq).padStart(3,"0")}`;
          const steps=resolveApprovalSteps(draft.approvalPlan,policy.groups);
          const creator=current.createdBy || actor;
          validateCreatorApprovalPlan(steps,creator,draft.approvalPlan.allowCreatorApproval);
          const version={schemaVersion:VERSION_SCHEMA_VERSION,brandId:brand,campaignId:id,versionId,versionSequence:seq,campaignSnapshot:draft,approvalPlanSnapshot:{...draft.approvalPlan,resolvedSteps:steps,policyRevision:policy.revision},createdAt:admin.firestore.FieldValue.serverTimestamp(),createdAtText:now,createdBy:actor};
          tx.create(versionRef(brand,versionId),version);
          let status;
          if (draft.approvalPlan.mode==="none") status=approvedStatus(draft.approvalPlan);
          else {
            status="pending_approval";
            const approvalState={schemaVersion:ACTIVITY_SALES_SCHEMA_VERSION,brandId:brand,campaignId:id,versionId,status:"pending",currentStepIndex:0,steps,decisions:{},allowCreatorApproval:draft.approvalPlan.allowCreatorApproval,creator,campaignTitle:draft.title,createdAt:admin.firestore.FieldValue.serverTimestamp(),createdAtText:now};
            tx.set(approvalRef(brand,versionId),{...approvalState,activeReviewerKeys:activeReviewerKeys(approvalState,decisionKey)},{merge:false});
          }
          if (status === "published") {
            tx.set(publishedRef(brand,id),buildActivitySalesPublication({
              brandId:brand,campaignId:id,versionId,campaignSnapshot:draft,publishedAtText:now,
            }),{merge:false});
          }
          tx.set(ref,{revision:next,versionSequence:seq,currentVersionId:versionId,status,releaseMode:draft.approvalPlan.releaseMode,scheduledPublishAtText:draft.approvalPlan.scheduledPublishAt || "",updatedAt:admin.firestore.FieldValue.serverTimestamp(),updatedAtText:now,updatedBy:actor,...(status==="published"?{publishedAt:admin.firestore.FieldValue.serverTimestamp(),publishedAtText:now,publishedBy:actor}:{})},{merge:true});
          tx.set(log,{...baseAudit,toStatus:status,revision:next,versionId},{merge:false});
          output={status,revision:next,versionId}; return;
        }

        if (action==="approve" || action==="return_for_changes") {
          if (current.status!=="pending_approval" || !current.currentVersionId) throw new ActivitySalesError("NOT_PENDING",409,"此活動目前不在審核中");
          const aRef=approvalRef(brand,current.currentVersionId); const aSnap=await tx.get(aRef);
          if (!aSnap.exists) throw new ActivitySalesError("APPROVAL_STATE_MISSING",409,"活動審核狀態遺失");
          const approval=aSnap.data() || {}; const stepIndex=Number(approval.currentStepIndex || 0); const step=(approval.steps || [])[stepIndex];
          if (!step || !actorInStep(step,actorCheck)) throw new ActivitySalesError("APPROVAL_FORBIDDEN",403,"目前帳號不是這一關的核准人員");
          if (approval.allowCreatorApproval!==true && sameIdentity(approval.creator || {},actor)) throw new ActivitySalesError("CREATOR_CANNOT_APPROVE",403,"此活動設定為建立者不可自行核准");
          const key=decisionKey(actor); const decisions={...(approval.decisions || {})};
          if (decisions[key]?.stepId===step.stepId) throw new ActivitySalesError("ALREADY_DECIDED",409,"此核准人員已完成本關操作");
          if (action==="return_for_changes") {
            decisions[key]={stepId:step.stepId,decision:"returned",actor,comment:text(body.comment,500),decidedAtText:now};
            tx.set(aRef,{status:"returned",decisions,activeReviewerKeys:[],returnedAt:admin.firestore.FieldValue.serverTimestamp(),returnedAtText:now},{merge:true});
            tx.set(ref,{revision:next,status:"returned",updatedAt:admin.firestore.FieldValue.serverTimestamp(),updatedAtText:now,updatedBy:actor},{merge:true});
            tx.set(log,{...baseAudit,toStatus:"returned",revision:next,versionId:current.currentVersionId,stepId:step.stepId},{merge:false});
            output={status:"returned",revision:next}; return;
          }
          decisions[key]={stepId:step.stepId,decision:"approved",actor,comment:text(body.comment,500),decidedAtText:now};
          const approvedActors=Object.values(decisions).filter((d)=>d?.stepId===step.stepId&&d?.decision==="approved").map((d)=>d.actor || {});
          const complete=step.quorum==="all" ? step.members.every((m)=>approvedActors.some((a)=>sameIdentity(m,a))) : approvedActors.length>=1;
          let nextIndex=stepIndex; let status="pending_approval"; let approvedSnapshot=null;
          if (complete) {
            nextIndex+=1;
            if (nextIndex>=(approval.steps || []).length) {
              const vSnap=await tx.get(versionRef(brand,current.currentVersionId));
              if (!vSnap.exists) throw new ActivitySalesError("VERSION_NOT_FOUND",409,"活動正式版本遺失");
              approvedSnapshot=vSnap.data()?.campaignSnapshot;
              status=approvedStatus(approvedSnapshot?.approvalPlan || {});
            }
          }
          if (status === "published") {
            tx.set(publishedRef(brand,id),buildActivitySalesPublication({
              brandId:brand,campaignId:id,versionId:current.currentVersionId,
              campaignSnapshot:approvedSnapshot,publishedAtText:now,
            }),{merge:false});
          }
          const nextApproval={...approval,status:status==="pending_approval"?"pending":"approved",currentStepIndex:Math.min(nextIndex,(approval.steps || []).length),decisions};
          tx.set(aRef,{status:nextApproval.status,currentStepIndex:nextApproval.currentStepIndex,decisions,
            activeReviewerKeys:activeReviewerKeys(nextApproval,decisionKey),
            updatedAt:admin.firestore.FieldValue.serverTimestamp(),updatedAtText:now,...(status!=="pending_approval"?{approvedAt:admin.firestore.FieldValue.serverTimestamp(),approvedAtText:now}:{})},{merge:true});
          tx.set(ref,{revision:next,status,updatedAt:admin.firestore.FieldValue.serverTimestamp(),updatedAtText:now,updatedBy:actor,...(status==="published"?{publishedAt:admin.firestore.FieldValue.serverTimestamp(),publishedAtText:now,publishedBy:actor}:{})},{merge:true});
          tx.set(log,{...baseAudit,toStatus:status,revision:next,versionId:current.currentVersionId,stepId:step.stepId},{merge:false});
          output={status,revision:next,currentStepIndex:Math.min(nextIndex,(approval.steps || []).length)}; return;
        }

        if (action==="publish") {
          if (!canPublish || current.status!=="approved") throw new ActivitySalesError("PUBLISH_FORBIDDEN",403,"目前帳號或活動狀態不可發布");
          if (current.releaseMode==="scheduled_after_approval") {
            const scheduledMs=Date.parse(current.scheduledPublishAtText || "");
            if (!Number.isFinite(scheduledMs) || Date.now()<scheduledMs) {
              throw new ActivitySalesError("SCHEDULE_NOT_READY",409,"尚未到活動排程發布時間");
            }
          }
          if (!current.currentVersionId) throw new ActivitySalesError("VERSION_NOT_FOUND",409,"活動正式版本遺失");
          const vSnap=await tx.get(versionRef(brand,current.currentVersionId));
          if (!vSnap.exists) throw new ActivitySalesError("VERSION_NOT_FOUND",409,"活動正式版本遺失");
          tx.set(publishedRef(brand,id),buildActivitySalesPublication({
            brandId:brand,campaignId:id,versionId:current.currentVersionId,
            campaignSnapshot:vSnap.data()?.campaignSnapshot,publishedAtText:now,
          }),{merge:false});
          tx.set(ref,{revision:next,status:"published",publishedAt:admin.firestore.FieldValue.serverTimestamp(),publishedAtText:now,publishedBy:actor,updatedAt:admin.firestore.FieldValue.serverTimestamp(),updatedAtText:now,updatedBy:actor},{merge:true});
          tx.set(log,{...baseAudit,toStatus:"published",revision:next,versionId:current.currentVersionId || ""},{merge:false});
          output={status:"published",revision:next}; return;
        }

        if (action==="stop") {
          if (!canPublish || current.status!=="published") throw new ActivitySalesError("STOP_FORBIDDEN",403,"目前帳號或活動狀態不可停止活動");
          // Remove frontline visibility atomically with authoritative stop.
          tx.delete(publishedRef(brand,id));
          tx.set(ref,{revision:next,status:"stopped",stoppedAt:admin.firestore.FieldValue.serverTimestamp(),stoppedAtText:now,stoppedBy:actor,updatedAt:admin.firestore.FieldValue.serverTimestamp(),updatedAtText:now,updatedBy:actor},{merge:true});
          tx.set(log,{...baseAudit,toStatus:"stopped",revision:next,versionId:current.currentVersionId || ""},{merge:false});
          output={status:"stopped",revision:next}; return;
        }

        if (action==="cancel") {
          if (!canCreate || !["draft","returned","approved"].includes(current.status)) throw new ActivitySalesError("CANCEL_FORBIDDEN",403,"目前帳號或活動狀態不可取消");
          tx.set(ref,{revision:next,status:"cancelled",cancelledAt:admin.firestore.FieldValue.serverTimestamp(),cancelledAtText:now,cancelledBy:actor,updatedAt:admin.firestore.FieldValue.serverTimestamp(),updatedAtText:now,updatedBy:actor},{merge:true});
          tx.set(log,{...baseAudit,toStatus:"cancelled",revision:next,versionId:current.currentVersionId || ""},{merge:false});
          output={status:"cancelled",revision:next}; return;
        }

        throw new ActivitySalesError("ACTION_UNSUPPORTED",400,"不支援的活動操作");
      });
      return res.status(200).json({ok:true,...output});
    } catch(error) {
      const status=Number(error?.status || 500);
      if (status>=500) console.error("manageActivityCampaign failed",error);
      return res.status(status).json({ok:false,code:error?.code || "CAMPAIGN_FAILED",message:error?.message || "活動目前無法更新",...(error?.details || {})});
    }
  });

  return {manageActivitySalesPolicy,manageActivityCampaign,getActivitySalesWorkspace};
}

module.exports={
  ACTIVITY_SALES_SCHEMA_VERSION,POLICY_SCHEMA_VERSION,VERSION_SCHEMA_VERSION,
  ActivitySalesError,normalizePolicy,normalizeGroups,normalizeSelectors,expandSelectors,
  selectorsAllow,normalizeApprovalPlan,resolveApprovalSteps,actorInStep,validateCreatorApprovalPlan,
  normalizeCampaignDraft,approvedStatus,decisionKey,assertActivitySalesSessionActor,createActivitySalesAuthorityFunctions,
};

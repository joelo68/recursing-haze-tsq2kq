import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";

const require=createRequire(import.meta.url);
const admin=require("../functions/node_modules/firebase-admin");
const PROJECT="demo-drcyj-activity-sales";
if (!process.env.FIRESTORE_EMULATOR_HOST ||
    (process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || PROJECT)!==PROJECT) {
  throw new Error("ACTIVITY_SALES_AMENDMENT_EMULATOR_ONLY");
}
if (!admin.apps.length) admin.initializeApp({projectId:PROJECT});
const db=admin.firestore();
const sleep=(ms)=>new Promise(resolve=>setTimeout(resolve,ms));
const today=(offset=0)=>{
  const parts=new Intl.DateTimeFormat("en-US",{timeZone:"Asia/Taipei",
    year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date(Date.now()+offset*86400000));
  const part=(type)=>parts.find(item=>item.type===type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
};

test("Phase 1C-4 Functions/Cloud Tasks Emulator: three brands preserve old projection until reviewed scheduled amendment swaps",{timeout:90000},async()=>{
  const suffix=Date.now().toString(36);
  const scheduleTime=new Date(Date.now()+12000).toISOString();
  const rows=[];
  for(const brand of ["cyj","anniu","yibo"]) {
    const root=brand==="cyj"?"artifacts/default-app-id/public/data":`brands/${brand}`;
    const campaignId=`c4_${brand}_${suffix}`;
    const oldId=`${campaignId}_v001`,newId=`${campaignId}_v002`;
    const col=(name,id)=>db.doc(`${root}/${name}/${id}`);
    const draft={title:`重大修訂_${brand}`,startDate:today(),endDate:today(5),
      storeScope:"all",stores:[],packages:[{packageId:"p1",name:"套餐",salePrice:600,
        items:[{itemId:"c1",name:"課程",quantity:1,attributedAmount:600}]}],
      approvalPlan:{mode:"all",releaseMode:"scheduled_after_approval",scheduledPublishAt:scheduleTime,
        allowCreatorApproval:false,steps:[]}};
    rows.push({brand,campaignId,oldId,newId,draft,
      campaign:col("activity_campaigns",campaignId),
      oldVersion:col("activity_campaign_versions",oldId),
      newVersion:col("activity_campaign_versions",newId),
      approval:col("activity_campaign_approvals",newId),
      publication:col("activity_sales_publications",campaignId),
      acknowledgement:col("activity_sales_acknowledgements",`${campaignId}_old_confirm`)});
  }
  try {
    for(const row of rows) {
      await row.oldVersion.set({brandId:row.brand,campaignId:row.campaignId,versionId:row.oldId,
        versionSequence:1,campaignSnapshot:{...row.draft,title:"舊版",approvalPlan:{mode:"none",releaseMode:"manual_after_approval"}}});
      await row.newVersion.set({brandId:row.brand,campaignId:row.campaignId,versionId:row.newId,
        baseVersionId:row.oldId,versionSequence:2,campaignSnapshot:row.draft});
      await row.approval.set({brandId:row.brand,campaignId:row.campaignId,versionId:row.newId,
        status:"approved",activeReviewerKeys:[]});
      await row.publication.set({brandId:row.brand,campaignId:row.campaignId,versionId:row.oldId,
        status:"published",title:"舊版",startDate:today(),endDate:today(5)});
      await row.acknowledgement.set({brandId:row.brand,campaignId:row.campaignId,versionId:row.oldId,accountId:"staff"});
    }
    // Independent per-document events; NOT a collection scan or production write.
    for(const row of rows) {
      await row.campaign.set({schemaVersion:"activity-sales-v1",brandId:row.brand,campaignId:row.campaignId,
        revision:6,versionSequence:2,status:"published",currentVersionId:row.oldId,
        releaseMode:"manual_after_approval",amendment:{status:"approved",versionId:row.newId,
          baseVersionId:row.oldId,releaseMode:"scheduled_after_approval",scheduledPublishAtText:scheduleTime,
          draft:row.draft}});
    }
    for(const row of rows) {
      const current=await row.publication.get();
      assert.equal(current.data()?.versionId,row.oldId);
    }
    let final=[];
    const deadline=Date.now()+75000;
    while(Date.now()<deadline) {
      final=await Promise.all(rows.map(async(row)=>({row,
        campaign:(await row.campaign.get()).data(),publication:(await row.publication.get()).data()})));
      if(final.every(({row,campaign,publication})=>campaign?.currentVersionId===row.newId &&
        publication?.versionId===row.newId)) break;
      await sleep(900);
    }
    assert.equal(final.length,3);
    for(const {row,campaign,publication} of final) {
      assert.equal(campaign.currentVersionId,row.newId,`${row.brand} scheduled amendment did not activate`);
      assert.equal(campaign.status,"published");
      assert.equal(campaign.amendment,null);
      assert.equal(publication.versionId,row.newId);
      assert.equal(publication.title,`重大修訂_${row.brand}`);
      assert.equal((await row.acknowledgement.get()).data()?.versionId,row.oldId);
    }
  } finally {
    for(const row of rows) await Promise.allSettled([
      row.campaign.delete(),row.oldVersion.delete(),row.newVersion.delete(),row.approval.delete(),
      row.publication.delete(),row.acknowledgement.delete(),
    ]);
  }
});

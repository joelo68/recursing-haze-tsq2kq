import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";

const require=createRequire(import.meta.url);
const admin=require("../functions/node_modules/firebase-admin");

const PROJECT="demo-drcyj-activity-sales";
const host=process.env.FIRESTORE_EMULATOR_HOST || "";
if (!host) throw new Error("ACTIVITY_SALES_FUNCTIONS_E2E_REQUIRES_FIRESTORE_EMULATOR");
const project=process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || PROJECT;
if (project!==PROJECT) throw new Error("ACTIVITY_SALES_FUNCTIONS_E2E_FORBIDS_NON_DEMO_PROJECT");
if (!admin.apps.length) admin.initializeApp({projectId:PROJECT});
const db=admin.firestore();

const sleep=(ms)=>new Promise(resolve=>setTimeout(resolve,ms));
const today=(offset=0)=>{
  const d=new Date(Date.now()+offset*86400000);
  const parts=new Intl.DateTimeFormat("en-US",{
    timeZone:"Asia/Taipei",year:"numeric",month:"2-digit",day:"2-digit",
  }).formatToParts(d);
  const v=(t)=>parts.find(p=>p.type===t)?.value;
  return `${v("year")}-${v("month")}-${v("day")}`;
};

test("Phase 1C-3 Functions/Cloud Tasks Emulator: all three brands schedule and publish their own immutable version", {timeout:75000}, async()=>{
  const nonce=Date.now().toString(36);
  const scheduledAt=new Date(Date.now()+8000).toISOString();
  const brands=["cyj","anniu","yibo"];
  const records=[];
  for (const brand of brands) {
    const base=brand==="cyj" ? "artifacts/default-app-id/public/data" : `brands/${brand}`;
    const campaignId=`c3e3_${brand}_${nonce}`;
    const versionId=`${campaignId}_v001`;
    const snapshot={
      title:`排程測試_${brand}`,startDate:today(0),endDate:today(3),
      shortSummary:"本機 Functions Cloud Tasks Emulator 驗證",
      storeScope:"all",stores:[],packages:[{
        packageId:"p1",name:"套組",salePrice:980,
        items:[{itemId:"course",name:"課程",quantity:1,attributedAmount:980}],
      }],
      approvalPlan:{mode:"none",releaseMode:"scheduled_after_approval",
        scheduledPublishAt:scheduledAt,allowCreatorApproval:false,steps:[]},
    };
    const version=db.doc(`${base}/activity_campaign_versions/${versionId}`);
    const campaign=db.doc(`${base}/activity_campaigns/${campaignId}`);
    const publication=db.doc(`${base}/activity_sales_publications/${campaignId}`);
    await version.set({
      schemaVersion:"activity-campaign-version-v1",brandId:brand,campaignId,versionId,
      versionSequence:1,campaignSnapshot:snapshot,
    });
    records.push({brand,campaignId,versionId,version,campaign,publication});
  }
  try {
    for (const row of records) {
      await row.campaign.set({
        schemaVersion:"activity-sales-v1",brandId:row.brand,
        campaignId:row.campaignId,currentVersionId:row.versionId,
        revision:2,status:"approved",releaseMode:"scheduled_after_approval",
        scheduledPublishAtText:scheduledAt,versionSequence:1,
      });
    }

    // TEST-ONLY bounded polling on the LOCAL emulator, never a production runtime query.
    const deadline=Date.now()+60000;
    let published=[];
    while (Date.now()<deadline) {
      published=await Promise.all(records.map(async(row)=>{
        const [campaign,projection]=await Promise.all([row.campaign.get(),row.publication.get()]);
        return {brand:row.brand,campaign:campaign.data() || {},projection:projection.exists ? projection.data():null};
      }));
      if (published.every(row=>row.campaign.status==="published" &&
        row.projection?.brandId===row.brand)) break;
      await sleep(800);
    }
    assert.equal(published.length,3);
    for (const entry of published) {
      assert.equal(entry.campaign.status,"published",`task never completed for ${entry.brand}`);
      assert.equal(entry.campaign.revision,3);
      assert.equal(entry.projection?.brandId,entry.brand);
      assert.equal(entry.projection?.status,"published");
    }
  } finally {
    for (const row of records) {
      // Delete only known temporary documents in the demo emulator.
      await Promise.allSettled([
        row.campaign.delete(),row.version.delete(),row.publication.delete(),
      ]);
    }
  }
});

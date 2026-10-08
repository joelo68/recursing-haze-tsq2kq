import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";

const require=createRequire(import.meta.url);
const {createAcknowledgementHandler}=require("../functions/activitySalesAcknowledgement.js");
const logic=require("../functions/activitySalesAcknowledgementLogic.js");

const identity={brandId:"cyj",campaignId:"demoA",versionId:"demoA_v001",
  roleId:"therapist",accountId:"T001"};
const pubPath="artifacts/default-app-id/public/data/activity_sales_publications/demoA";
const ackPath=`artifacts/default-app-id/public/data/activity_sales_acknowledgements/${logic.acknowledgementDocumentId(identity)}`;
const validClaims={drcyjIdentity:true,identityVersion:"application-identity-v1",
  brandId:"cyj",roleId:"therapist",accountId:"T001"};
const admin={firestore:{FieldValue:{serverTimestamp:()=>"<serverTime>"}}};

function fixture({claim=validClaims,trust=true}={}) {
  const docs=new Map([[pubPath,{status:"published",brandId:"cyj",campaignId:"demoA",versionId:"demoA_v001"}]]);
  const operations=[];
  const getCollection=(_db,brand,name)=>{
    const prefix=brand==="cyj" ? "artifacts/default-app-id/public/data" : `brands/${brand}`;
    return {doc:(id)=>({path:`${prefix}/${name}/${id}`})};
  };
  const db={async runTransaction(fn){
    const before=operations.length;
    const result=await fn({
      get:async(ref)=>({exists:docs.has(ref.path),data:()=>docs.get(ref.path)}),
      create:(ref,data)=>operations.push({op:"create",ref,data}),
    });
    for (const op of operations.slice(before)) {
      if (docs.has(op.ref.path)) throw new Error("DUPLICATE_CREATE");
      docs.set(op.ref.path,op.data);
    }
    return result;
  }};
  const services={
    requireFirebaseRequestAuth:async()=>({ok:true,decoded:claim}),
    verifyTrustedApplicationActor:async()=>trust ?
      {ok:true,actorRole:"therapist",actorAccountId:"T001"} : {ok:false},
    getBrandCollection:getCollection,
  };
  const handler=createAcknowledgementHandler({admin,db,services});
  const actor={roleId:"therapist",accountId:"T001",deviceId:"device1",credentialPassword:"secret"};
  async function post(action="status",overrides={}) {
    const req={method:"POST",headers:{authorization:"Bearer xyz"},
      body:{action,brandId:"cyj",campaignId:"demoA",versionId:"demoA_v001",actor,
        confirmUnderstood:action==="acknowledge",...overrides}};
    const res={statusCode:200,body:null,status(n){this.statusCode=n;return this;},
      json(data){this.body=data;return this;}};
    await handler(req,res);
    return res;
  }
  return {docs,operations,post};
}

test("per-brand version+role+account hash stable without exposed account path",()=>{
  const id=logic.acknowledgementDocumentId(identity);
  assert.match(id,/^ack_[a-f0-9]{48}$/);
  assert.notEqual(id,logic.acknowledgementDocumentId({...identity,versionId:"demoA_v002"}));
  assert.notEqual(id,logic.acknowledgementDocumentId({...identity,brandId:"yibo"}));
  assert.notEqual(id,logic.acknowledgementDocumentId({...identity,accountId:"T002"}));
  assert.throws(()=>logic.normalizeAcknowledgementIdentity({...identity,brandId:"other"}));
});

test("status checks single current publication, does not write",async()=>{
  const f=fixture();
  const res=await f.post("status");
  assert.equal(res.statusCode,200);
  assert.equal(res.body.acknowledged,false);
  assert.equal(f.operations.length,0);
});

test("confirm requires explicit acknowledgement and writes immutable one-doc",async()=>{
  const f=fixture();
  const no=await f.post("acknowledge",{confirmUnderstood:false});
  assert.equal(no.statusCode,400);
  const yes=await f.post("acknowledge");
  assert.equal(yes.statusCode,200);
  assert.equal(yes.body.acknowledged,true);
  assert.equal(f.operations.length,1);
  assert.equal(f.docs.get(ackPath).versionId,"demoA_v001");
  const retry=await f.post("acknowledge");
  assert.equal(retry.statusCode,200);
  assert.equal(retry.body.state,"existing");
  assert.equal(f.operations.length,1);
});

test("publisher stop/replace between confirmation and transaction fails closed",async()=>{
  for (const revised of [{status:"stopped"}, {versionId:"demoA_v002"}]) {
    const f=fixture(); f.docs.set(pubPath,{...f.docs.get(pubPath),...revised});
    const res=await f.post("acknowledge");
    assert.equal(res.statusCode,409);
    assert.equal(res.body.code,"ACK_PUBLICATION_CHANGED");
    assert.equal(f.docs.has(ackPath),false);
  }
});

test("cross-brand, claim-account mismatch, and untrusted device denied",async()=>{
  const f=fixture();
  const cross=await f.post("acknowledge",{brandId:"anniu"});
  assert.notEqual(cross.statusCode,200);
  const wrong=fixture({claim:{...validClaims,accountId:"T002"}});
  assert.equal((await wrong.post("acknowledge")).statusCode,403);
  const untrusted=fixture({trust:false});
  assert.equal((await untrusted.post("acknowledge")).statusCode,403);
  assert.equal(f.operations.length,0);
});

test("cannot overwrite a mismatched acknowledgement identity",async()=>{
  const f=fixture(); f.docs.set(ackPath,{brandId:"cyj",campaignId:"demoA",
    versionId:"demoA_v001",roleId:"manager",accountId:"T001"});
  const result=await f.post("acknowledge");
  assert.equal(result.statusCode,500);
  assert.equal(f.operations.length,0);
});

test("public version changes require new acknowledgement id",()=>{
  assert.equal(logic.isCurrentPublication({
    brandId:"cyj",campaignId:"demoA",versionId:"demoA_v002",status:"published"
  }, identity),false);
});

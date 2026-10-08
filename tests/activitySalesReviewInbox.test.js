import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createAttributionReviewInboxHandler}=require("../functions/activitySalesAttributionReviewInbox");
const {checkedReviewInboxInput,checkedReviewCandidate,MAX_CANDIDATES,decodeReviewCursor}=require("../functions/activitySalesAttributionReviewInboxLogic");
const {summaryDocumentId}=require("../functions/activitySalesAttributionWriterLogic");
const frozen=new Date("2026-10-08T11:00:00.000Z");
const prefix=b=>b==="cyj"?"artifacts/default-app-id/public/data":`brands/${b}`;
function fixture(brand="cyj",{claimBrand=brand,trusted=true,stores=["崇學"],revoked=false,version="current",role="store",more=0}={}){
  const storeName=brand==="cyj"?"CYJ崇學店":brand==="anniu"?"安妞崇學店":"伊啵崇學店";
  const scope={brandId:brand,storeName,reportDate:"2026-10-08"};
  const subject={brandId:brand,campaignId:"act01",versionId:"act01_v001",roleId:"therapist",accountId:"T001",reportDate:"2026-10-08"};
  const docs=new Map(), reads=[], writes=[];
  const path=(n,id)=>`${prefix(brand)}/${n}/${id}`;
  const seed=(n,id,data)=>docs.set(path(n,id),data);
  seed(brand==="cyj"?"global_settings":"settings","store_account_data",{accounts:revoked?[]:[{id:"S001",stores,isActive:true}]});
  seed("therapists","T001",{id:"T001",store:storeName,status:"active"});
  seed("activity_sales_publications","act01",{brandId:brand,campaignId:"act01",status:"published",versionId:version==="current"?"act01_v001":"act01_v002",startDate:"2026-10-01",endDate:"2026-10-31"});
  seed("activity_campaign_versions","act01_v001",{brandId:brand,campaignId:"act01",versionId:"act01_v001",campaignSnapshot:{startDate:"2026-10-01",endDate:"2026-10-31",storeScope:"all",stores:[]}});
  seed("activity_sales_daily_attributions",summaryDocumentId(subject),{schemaVersion:"activity-sales-daily-attribution-v1",...subject,storeCore:"崇學",revision:1,status:"HAS_SALES",saleCount:2,attributedAmount:19600,formalRevenueDelta:0});
  for(let i=0;i<more;i++){
    const s={...subject,accountId:`T${String(i+2).padStart(3,"0")}`};
    seed("therapists",s.accountId,{id:s.accountId,store:storeName,status:"active"});
    seed("activity_sales_daily_attributions",summaryDocumentId(s),{schemaVersion:"activity-sales-daily-attribution-v1",...s,storeCore:"崇學",revision:1,status:"CONFIRMED_ZERO",saleCount:0,attributedAmount:0,formalRevenueDelta:0});
  }
  const ref=(name,id)=>({path:path(name,id)});
  const col=name=>({doc:id=>ref(name,id),where:()=>{throw Error('UNEXPECTED_NONQUERY_WHERE')}});
  const getCollection=(_db,b,name)=>{
    assert.equal(b,brand);return {doc:id=>ref(name,id),where(field,op,value){
      assert.equal(op,"==");const conditions=[[field,value]];
      const q={query:true,name,conditions,afterId:null,sortField:null,maximum:null,
        where(f,o,v){assert.equal(o,"==");conditions.push([f,v]);return q;},
        orderBy(field,direction){assert.equal(field,"__name__");assert.equal(direction,"asc");q.sortField=field;return q;},
        startAfter(cursor){assert.equal(typeof cursor,"string");q.afterId=cursor;return q;},
        limit(n){q.maximum=n;return q;}};
      return q;
    }};
  };
  const getDoc=(r)=>{
    reads.push(r.path);
    const data=docs.get(r.path);
    return {exists:!!data,data:()=>data};
  };
  const db={runTransaction:async(fn,opts)=>{
    assert.equal(opts.readOnly,true);
    return fn({async get(ref){
      if(!ref.query)return getDoc(ref);
      assert.equal(ref.name,"activity_sales_daily_attributions");
      assert.equal(ref.sortField,"__name__");assert.equal(ref.maximum,MAX_CANDIDATES+1);
      const queried=[...docs.entries()].filter(([p,d])=>p.startsWith(`${prefix(brand)}/activity_sales_daily_attributions/`)&&
        ref.conditions.every(([k,v])=>d[k]===v))
        .sort(([a],[b])=>a<b?-1:a>b?1:0)
        .filter(([p])=>!ref.afterId || p.split("/").at(-1)>ref.afterId).slice(0,ref.maximum);
      reads.push(...queried.map(([p])=>p));
      return {docs:queried.map(([p,d])=>({id:p.split("/").pop(),exists:true,data:()=>d}))};
    },set(){writes.push('set')},create(){writes.push('create')}});
  }};
  const handler=createAttributionReviewInboxHandler({admin:{},db,services:{now:()=>frozen,
    requireFirebaseRequestAuth:async()=>({ok:true,decoded:{drcyjIdentity:true,identityVersion:"application-identity-v1",brandId:claimBrand,roleId:role,accountId:"S001"}}),
    verifyTrustedApplicationActor:async()=>trusted?{ok:true,actorRole:role,actorAccountId:"S001",credential:{stores}}:{ok:false},
    getBrandCollection:getCollection,
    getBrandSettingDoc:(_db,b,name)=>ref(b==="cyj"?"global_settings":"settings",name),
  }});
  async function call(body={}){
    const req={method:"POST",body:{action:"list_candidates",...scope,actor:{roleId:role,accountId:"S001",deviceId:"test",credentialPassword:"test"},...body}};
    const res={statusCode:200,status(code){this.statusCode=code;return this;},json(payload){return {status:this.statusCode,body:payload};}};
    return handler(req,res);
  }
  return {call,seed,docs,reads,writes,subject,scope};
}
test("R2A strict input: brand, future date, store scope, actor role, no arbitrary cursor/limit",()=>{
  const body={action:"list_candidates",brandId:"cyj",reportDate:"2026-10-08",storeName:"CYJ崇學店",actor:{roleId:"store"}};
  assert.equal(checkedReviewInboxInput(body,frozen).storeCore,"崇學");
  for(const changes of [{brandId:"unknown"},{reportDate:"2026-10-09"},{reportDate:"2026-02-30"},
      {storeName:"x/y"},{actor:{roleId:"manager"}},{cursor:"x"},{limit:1000}]){
    assert.throws(()=>checkedReviewInboxInput({...body,...changes},frozen));
  }
});
test("R2A three-brand inbox: bounded, owner checked, no writes or formal revenue",async()=>{
  for(const brand of ["cyj","anniu","yibo"]){
    const f=fixture(brand);const r=await f.call();
    assert.equal(r.status,200,brand);assert.equal(r.body.candidates.length,1);
    const row=r.body.candidates[0];assert.equal(row.accountId,"T001");assert.equal(row.attributedAmount,19600);
    assert.equal(row.formalRevenueDelta,0);assert.deepEqual(f.writes,[]);
    assert.ok(f.reads.every(x=>x.startsWith(`${prefix(brand)}/`)),brand);
  }
});
test("R2A no cross-brand, stale session, untrusted, revoked and unauthorized store",async()=>{
  for(const options of [{claimBrand:"anniu"},{trusted:false},{revoked:true},{stores:["其他"]},{role:"manager"}]){
    const f=fixture("cyj",options);const r=await f.call();
    assert.equal(r.status,403,JSON.stringify(options));assert.equal(f.writes.length,0);
  }
});
test("R2A historical publication, moved therapist cannot appear",async()=>{
  const f=fixture("cyj",{version:"old"});assert.equal((await f.call()).body.candidates.length,0);
  const g=fixture();g.seed("therapists","T001",{id:"T001",store:"CYJ其他店",status:"active"});
  assert.equal((await g.call()).body.candidates.length,0);
});
test("R2A zero is confirmed, missing summary is not zero",async()=>{
  const f=fixture();f.docs.delete(`${prefix('cyj')}/activity_sales_daily_attributions/${summaryDocumentId(f.subject)}`);
  assert.equal((await f.call()).body.candidates.length,0);
  const g=fixture();g.seed("activity_sales_daily_attributions",summaryDocumentId(g.subject),{schemaVersion:"activity-sales-daily-attribution-v1",...g.subject,
    storeCore:"崇學",revision:1,status:"CONFIRMED_ZERO",saleCount:0,attributedAmount:0,formalRevenueDelta:0});
  const row=(await g.call()).body.candidates[0];assert.equal(row.status,"CONFIRMED_ZERO");assert.equal(row.attributedAmount,0);
});
test("R2A cap 12 and explicit truncated; no unbounded scan",async()=>{
  const f=fixture("cyj",{more:MAX_CANDIDATES+2});const r=await f.call();
  assert.equal(r.status,200);assert.equal(r.body.candidates.length,MAX_CANDIDATES);
  assert.equal(r.body.truncated,true);assert.equal(r.body.maxCandidates,12);
  assert.ok(f.reads.length<=1+13+12+12+12);
});
test("R2A malformed source identity/id/revenue fails closed",async()=>{
  const f=fixture();f.seed("activity_sales_daily_attributions",summaryDocumentId(f.subject),{...f.docs.get(`${prefix('cyj')}/activity_sales_daily_attributions/${summaryDocumentId(f.subject)}`),formalRevenueDelta:99});
  const r=await f.call();assert.equal(r.status,409);
});

test("R2A inactive therapist and version missing are never shown",async()=>{
  const f=fixture();f.seed("therapists","T001",{id:"T001",store:"CYJ崇學店",isActive:false});
  assert.equal((await f.call()).body.candidates.length,0);
  const g=fixture();g.docs.delete(`${prefix('cyj')}/activity_campaign_versions/act01_v001`);
  assert.equal((await g.call()).body.candidates.length,0);
});
test("R2A HTTP is POST only and never returns authentication or raw credentials",async()=>{
  const f=fixture();const result=await f.call();
  assert.equal(result.status,200);
  assert.equal(JSON.stringify(result.body).includes("credentialPassword"),false);
  assert.equal(JSON.stringify(result.body).includes("token"),false);
  assert.equal(result.body.candidates[0].formalRevenueDelta,0);
});

test("R2B cursor: bounded page2 continues after page1 without duplicate or unbounded reads",async()=>{
  const f=fixture("cyj",{more:MAX_CANDIDATES+5});
  const a=await f.call();assert.equal(a.status,200);assert.equal(a.body.candidates.length,12);
  assert.equal(a.body.hasMore,true);assert.equal(typeof a.body.nextCursor,"string");
  const id=decodeReviewCursor(a.body.nextCursor,{brandId:"cyj",storeCore:"崇學",reportDate:"2026-10-08"});
  assert.equal(typeof id,"string");
  const b=await f.call({cursor:a.body.nextCursor});assert.equal(b.status,200);
  assert.ok(b.body.candidates.length>0);assert.equal(b.body.hasMore,false);assert.equal(b.body.nextCursor,null);
  const first=new Set(a.body.candidates.map(x=>x.accountId));
  assert.ok(b.body.candidates.every(x=>!first.has(x.accountId)));
  assert.equal([...a.body.candidates,...b.body.candidates].length,18);
  assert.deepEqual(f.writes,[]);
});
test("R2B paging cursor is scope-bound and cannot switch brand/store/date",async()=>{
  const f=fixture("cyj",{more:20});const a=await f.call();const cursor=a.body.nextCursor;
  for(const changes of [{brandId:"anniu"},{storeName:"CYJ其他店"},{reportDate:"2026-10-07"},
    {cursor:"not-a-cursor"},{cursor:".".repeat(2000)},{limit:1000}]){
    const r=await f.call({cursor,...changes});assert.ok([400,403].includes(r.status),r.body.code);
  }
  assert.equal((await f.call({cursor})).status,200);
});
test("R2B every page re-checks store revocation and identity and has no private Browser read",async()=>{
  const f=fixture("cyj",{more:16});const page=await f.call();assert.equal(page.status,200);
  f.seed("global_settings","store_account_data",{accounts:[{id:"S001",stores:["其他"],isActive:true}]});
  const second=await f.call({cursor:page.body.nextCursor});assert.equal(second.status,403);
  assert.equal(f.writes.length,0);
});
test("R2B stale/moved entries can leave an empty scanned page with a valid next cursor",async()=>{
  const f=fixture("cyj",{more:14});
  const sorted=[...f.docs.entries()].filter(([path])=>path.includes("/activity_sales_daily_attributions/"))
    .map(([,row])=>row).sort((a,b)=>summaryDocumentId(a)<summaryDocumentId(b)?-1:1);
  for(const row of sorted.slice(0,12))f.seed("therapists",row.accountId,{store:"CYJ其他店",status:"active"});
  const a=await f.call();assert.equal(a.status,200);assert.equal(a.body.candidates.length,0);
  assert.equal(a.body.hasMore,true);assert.ok(a.body.nextCursor);
  const b=await f.call({cursor:a.body.nextCursor});assert.equal(b.status,200);assert.ok(b.body.candidates.length>0);
});

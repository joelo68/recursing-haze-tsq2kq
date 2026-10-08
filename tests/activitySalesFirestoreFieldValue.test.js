import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import Module from "node:module";

const require = createRequire(import.meta.url);
const {activitySalesServerTimestamp} = require("../functions/activitySalesFirestoreFieldValue.js");

test("Phase 1C-3 timestamp adapter honors injected FieldValue in existing isolated unit fixtures", () => {
  const expected={source:"fixture"};
  const admin={firestore:{FieldValue:{serverTimestamp:()=>expected}}};
  assert.equal(activitySalesServerTimestamp(admin), expected);
});

test("Phase 1C-3 timestamp adapter uses firebase-admin/firestore when legacy namespace is absent", () => {
  const expected={source:"modular-firestore"};
  const originalLoad=Module._load;
  let calls=0;
  try {
    Module._load=function(request,parent,isMain) {
      if(request === "firebase-admin/firestore") {
        calls++;
        return {FieldValue:{serverTimestamp:()=>expected}};
      }
      return originalLoad.apply(this,arguments);
    };
    assert.equal(activitySalesServerTimestamp({firestore:()=>{}}), expected);
    assert.equal(calls, 1);
  } finally {
    Module._load=originalLoad;
  }
});

test("Phase 1C-3 timestamp adapter fails closed if modular SDK does not provide serverTimestamp", () => {
  const originalLoad=Module._load;
  try {
    Module._load=function(request,parent,isMain) {
      if(request === "firebase-admin/firestore") return {FieldValue:{}};
      return originalLoad.apply(this,arguments);
    };
    assert.throws(()=>activitySalesServerTimestamp({firestore:()=>{}}),
      /ACTIVITY_SALES_FIRESTORE_TIMESTAMP_UNAVAILABLE/);
  } finally {
    Module._load=originalLoad;
  }
});

test("All Activity Sales writers share timestamp adapter, no legacy-only timestamp calls remain",()=>{
  const fs = require("node:fs");
  const root = new URL("../functions/", import.meta.url);
  for(const name of ["activitySalesAuthority.js", "activitySalesAcknowledgement.js", "activitySalesScheduledPublisher.js"]){
    const text=fs.readFileSync(new URL(name,root),"utf8");
    assert.match(text, /activitySalesServerTimestamp\(admin\)/);
    assert.doesNotMatch(text, /admin\.firestore\.FieldValue\.serverTimestamp\(\)/);
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { initializeApp, deleteApp } from "firebase/app";
import {
  getAuth,
  connectAuthEmulator,
  signInAnonymously,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import {
  getFirestore,
  connectFirestoreEmulator,
  doc,
  getDoc,
  setDoc,
  terminate,
} from "firebase/firestore";

const require = createRequire(import.meta.url);
const admin = require("../functions/node_modules/firebase-admin");

const PROJECT_ID = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "demo-drcyj-activity-sales";
const FIRESTORE_HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8180";
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9199";

process.env.FIRESTORE_EMULATOR_HOST = FIRESTORE_HOST;
process.env.FIREBASE_AUTH_EMULATOR_HOST = AUTH_HOST;

const [firestoreHost, firestorePortText] = FIRESTORE_HOST.split(":");
const [authHost, authPortText] = AUTH_HOST.split(":");
const firestorePort = Number(firestorePortText || 8180);
const authUrl = `http://${authHost}:${Number(authPortText || 9199)}`;

if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT_ID });
const adminDb = admin.firestore();

let appSeq = 0;
function makeClient(label) {
  appSeq += 1;
  const app = initializeApp({
    projectId: PROJECT_ID,
    apiKey: "demo-key",
    authDomain: `${PROJECT_ID}.firebaseapp.com`,
  }, `${label}-${appSeq}`);
  const auth = getAuth(app);
  connectAuthEmulator(auth, authUrl, { disableWarnings: true });
  const db = getFirestore(app);
  connectFirestoreEmulator(db, firestoreHost, firestorePort);
  return { app, auth, db };
}

async function cleanupClient(client) {
  try { await signOut(client.auth); } catch {}
  try { await terminate(client.db); } catch {}
  try { await deleteApp(client.app); } catch {}
}

async function expectAllowed(promise, label) {
  try {
    return await promise;
  } catch (error) {
    assert.fail(`${label} expected ALLOW but got ${error?.code || error?.message || error}`);
  }
}

async function expectDenied(promise, label) {
  let denied = false;
  try {
    await promise;
  } catch (error) {
    denied = ["permission-denied", "PERMISSION_DENIED", "firestore/permission-denied"]
      .some((value) => String(error?.code || error?.message || "").includes(value));
  }
  assert.equal(denied, true, `${label} expected DENY`);
}

async function createClaimedUser({ brandId, accountId }) {
  const client = makeClient(`activity-${brandId}`);
  const email = `${brandId}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
  const password = "rules-test-Password-123!";
  const credential = await createUserWithEmailAndPassword(client.auth, email, password);
  await admin.auth().setCustomUserClaims(credential.user.uid, {
    drcyjIdentity: true,
    identityVersion: "application-identity-v1",
    brandId,
    roleId: "director",
    accountId,
  });
  await signOut(client.auth);
  await signInWithEmailAndPassword(client.auth, email, password);
  await client.auth.currentUser.getIdToken(true);
  return client;
}

const PRIVATE_COLLECTIONS = [
  "activity_sales_policy", "activity_campaigns", "activity_campaign_versions",
  "activity_campaign_approvals", "activity_sales_audit",
];
const PUBLIC_COLLECTION = "activity_sales_publications";

test("Activity Sales Phase 1B rules: private drafts denied; published projection same-brand read-only", async () => {
  let anniu = null;
  let cyj = null;
  let anonymous = null;
  try {
    await adminDb.recursiveDelete(adminDb.collection("brands"));
    await adminDb.recursiveDelete(adminDb.collection("artifacts"));
    for (const coll of [...PRIVATE_COLLECTIONS, PUBLIC_COLLECTION]) {
      await adminDb.doc(`brands/anniu/${coll}/sample`).set({ brandId: "anniu", value: 1 });
      await adminDb.doc(`brands/yibo/${coll}/sample`).set({ brandId: "yibo", value: 2 });
      await adminDb.doc(`artifacts/default-app-id/public/data/${coll}/sample`).set({ brandId: "cyj", value: 3 });
    }
    anniu = await createClaimedUser({ brandId: "anniu", accountId: "anniu-admin" });
    cyj = await createClaimedUser({ brandId: "cyj", accountId: "cyj-admin" });
    anonymous = makeClient("activity-anonymous");
    await signInAnonymously(anonymous.auth);

    for (const coll of PRIVATE_COLLECTIONS) {
      await expectDenied(getDoc(doc(anniu.db, "brands", "anniu", coll, "sample")), `anniu ${coll} private read`);
      await expectDenied(getDoc(doc(cyj.db, "artifacts", "default-app-id", "public", "data", coll, "sample")), `CYJ ${coll} private read`);
      await expectDenied(setDoc(doc(anniu.db, "brands", "anniu", coll, "browser-write"), { injected: true }), `anniu ${coll} private write`);
      await expectDenied(setDoc(doc(cyj.db, "artifacts", "default-app-id", "public", "data", coll, "browser-write"), { injected: true }), `CYJ ${coll} private write`);
    }

    await expectAllowed(getDoc(doc(anniu.db, "brands", "anniu", PUBLIC_COLLECTION, "sample")), "anniu published read");
    await expectAllowed(getDoc(doc(cyj.db, "artifacts", "default-app-id", "public", "data", PUBLIC_COLLECTION, "sample")), "CYJ published legacy read");
    await expectDenied(setDoc(doc(anniu.db, "brands", "anniu", PUBLIC_COLLECTION, "browser-write"), { injected: true }), "anniu published browser write");
    await expectDenied(setDoc(doc(cyj.db, "artifacts", "default-app-id", "public", "data", PUBLIC_COLLECTION, "browser-write"), { injected: true }), "CYJ published browser write");
    await expectDenied(getDoc(doc(anniu.db, "brands", "yibo", PUBLIC_COLLECTION, "sample")), "anniu to yibo cross-brand read");
    await expectDenied(getDoc(doc(cyj.db, "brands", "anniu", PUBLIC_COLLECTION, "sample")), "CYJ to anniu cross-brand read");
    await expectDenied(getDoc(doc(anniu.db, "artifacts", "default-app-id", "public", "data", PUBLIC_COLLECTION, "sample")), "anniu to CYJ legacy cross-brand read");
    await expectDenied(getDoc(doc(anonymous.db, "brands", "anniu", PUBLIC_COLLECTION, "sample")), "anonymous publication read");
    await expectDenied(getDoc(doc(anonymous.db, "artifacts", "default-app-id", "public", "data", PUBLIC_COLLECTION, "sample")), "anonymous CYJ publication read");
  } finally {
    if (anonymous) await cleanupClient(anonymous);
    if (cyj) await cleanupClient(cyj);
    if (anniu) await cleanupClient(anniu);
  }
});

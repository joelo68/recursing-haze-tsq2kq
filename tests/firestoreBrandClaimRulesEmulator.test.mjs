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
  deleteDoc,
  terminate,
} from "firebase/firestore";

const require = createRequire(import.meta.url);
const admin = require("../functions/node_modules/firebase-admin");

const PROJECT_ID = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "cyjsituation-analysis";
const FIRESTORE_HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099";

process.env.FIRESTORE_EMULATOR_HOST = FIRESTORE_HOST;
process.env.FIREBASE_AUTH_EMULATOR_HOST = AUTH_HOST;

const [firestoreHost, firestorePortText] = FIRESTORE_HOST.split(":");
const [authHost, authPortText] = AUTH_HOST.split(":");
const firestorePort = Number(firestorePortText || 8080);
const authUrl = `http://${authHost}:${Number(authPortText || 9099)}`;

if (!admin.apps.length) {
  admin.initializeApp({ projectId: PROJECT_ID });
}
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

async function createClaimedUser({ brandId, roleId = "director", accountId }) {
  const client = makeClient(`claim-${brandId}`);
  const email = `${brandId}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
  const password = "rules-test-Password-123!";
  const credential = await createUserWithEmailAndPassword(client.auth, email, password);
  await admin.auth().setCustomUserClaims(credential.user.uid, {
    drcyjIdentity: true,
    identityVersion: "application-identity-v1",
    brandId,
    roleId,
    accountId,
  });
  await signOut(client.auth);
  await signInWithEmailAndPassword(client.auth, email, password);
  await client.auth.currentUser.getIdToken(true);
  return client;
}

test("P0-FINAL-1C-2 emulator semantics: anonymous bootstrap, brand isolation, CYJ legacy, and root fallback", async () => {
  await adminDb.recursiveDelete(adminDb.collection("brands"));
  await adminDb.recursiveDelete(adminDb.collection("artifacts"));
  await adminDb.recursiveDelete(adminDb.collection("notification_rules"));

  const anonymous = makeClient("anonymous");
  await signInAnonymously(anonymous.auth);
  const anonymousUid = anonymous.auth.currentUser.uid;

  await adminDb.doc("brands/anniu/login_directory_summary/current").set({ ok: true });
  await adminDb.doc("brands/anniu/private_data/doc1").set({ brandId: "anniu", value: 1 });
  await adminDb.doc("brands/yibo/private_data/doc1").set({ brandId: "yibo", value: 2 });
  await adminDb.doc("artifacts/default-app-id/public/data/login_directory_summary/current").set({ ok: true });
  await adminDb.doc("artifacts/default-app-id/public/data/global_settings/system_version").set({ version: "3.6.0" });
  await adminDb.doc("artifacts/default-app-id/public/data/private_data/doc1").set({ brandId: "cyj", value: 3 });
  await adminDb.doc("brands/anniu/device_approval_requests/own").set({
    status: "pending",
    bootstrapAuthUid: anonymousUid,
  });
  await adminDb.doc("brands/anniu/device_approval_requests/other").set({
    status: "pending",
    bootstrapAuthUid: "someone-else",
  });
  await adminDb.doc("notification_rules/global1").set({ global: true });

  await expectAllowed(
    getDoc(doc(anonymous.db, "brands", "anniu", "login_directory_summary", "current")),
    "anonymous sanitized new-brand login directory"
  );
  await expectAllowed(
    getDoc(doc(anonymous.db, "artifacts", "default-app-id", "public", "data", "login_directory_summary", "current")),
    "anonymous sanitized CYJ login directory"
  );
  await expectAllowed(
    getDoc(doc(anonymous.db, "artifacts", "default-app-id", "public", "data", "global_settings", "system_version")),
    "anonymous system version"
  );
  await expectAllowed(
    getDoc(doc(anonymous.db, "brands", "anniu", "device_approval_requests", "own")),
    "anonymous own pending device request"
  );
  await expectDenied(
    getDoc(doc(anonymous.db, "brands", "anniu", "device_approval_requests", "other")),
    "anonymous other pending device request"
  );
  await expectDenied(
    getDoc(doc(anonymous.db, "brands", "anniu", "private_data", "doc1")),
    "anonymous generic brand data"
  );
  await expectDenied(
    getDoc(doc(anonymous.db, "artifacts", "default-app-id", "public", "data", "private_data", "doc1")),
    "anonymous CYJ generic data"
  );
  await expectDenied(
    getDoc(doc(anonymous.db, "notification_rules", "global1")),
    "anonymous root fallback"
  );

  const anniu = await createClaimedUser({
    brandId: "anniu",
    roleId: "director",
    accountId: "anniu-director",
  });
  await expectAllowed(
    getDoc(doc(anniu.db, "brands", "anniu", "private_data", "doc1")),
    "anniu same-brand read"
  );
  await expectAllowed(
    setDoc(doc(anniu.db, "brands", "anniu", "private_data", "doc2"), { value: 22 }),
    "anniu same-brand compatibility write"
  );
  await expectDenied(
    getDoc(doc(anniu.db, "brands", "yibo", "private_data", "doc1")),
    "anniu cross-brand yibo read"
  );
  await expectDenied(
    getDoc(doc(anniu.db, "artifacts", "default-app-id", "public", "data", "private_data", "doc1")),
    "anniu cross-brand CYJ legacy read"
  );
  await expectAllowed(
    getDoc(doc(anniu.db, "brands", "anniu", "device_approval_requests", "other")),
    "anniu same-brand device request after application session"
  );
  await expectAllowed(
    getDoc(doc(anniu.db, "artifacts", "default-app-id", "public", "data", "global_settings", "system_version")),
    "anniu application identity global system version"
  );
  await expectAllowed(
    getDoc(doc(anniu.db, "notification_rules", "global1")),
    "application identity root compatibility read"
  );

  const cyj = await createClaimedUser({
    brandId: "cyj",
    roleId: "director",
    accountId: "cyj-director",
  });
  await expectAllowed(
    getDoc(doc(cyj.db, "artifacts", "default-app-id", "public", "data", "private_data", "doc1")),
    "CYJ same-brand legacy read"
  );
  await expectAllowed(
    setDoc(doc(cyj.db, "artifacts", "default-app-id", "public", "data", "private_data", "doc2"), { value: 33 }),
    "CYJ same-brand legacy compatibility write"
  );
  await expectDenied(
    getDoc(doc(cyj.db, "brands", "anniu", "private_data", "doc1")),
    "CYJ cross-brand anniu read"
  );

  const noClaims = makeClient("no-claims");
  const email = `noclaims-${Date.now()}@example.test`;
  const password = "rules-test-Password-123!";
  await createUserWithEmailAndPassword(noClaims.auth, email, password);
  await expectDenied(
    getDoc(doc(noClaims.db, "brands", "anniu", "private_data", "doc1")),
    "signed-in non-application identity generic brand read"
  );
  await expectDenied(
    getDoc(doc(noClaims.db, "notification_rules", "global1")),
    "signed-in non-application identity root read"
  );

  await cleanupClient(noClaims);
  await cleanupClient(cyj);
  await cleanupClient(anniu);
  await cleanupClient(anonymous);
});

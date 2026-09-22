import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { initializeApp, deleteApp } from "firebase/app";
import {
  getAuth,
  connectAuthEmulator,
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

const PROJECT_ID = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "cyjsituation-analysis";
const FIRESTORE_HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099";

process.env.FIRESTORE_EMULATOR_HOST = FIRESTORE_HOST;
process.env.FIREBASE_AUTH_EMULATOR_HOST = AUTH_HOST;

const [firestoreHost, firestorePortText] = FIRESTORE_HOST.split(":");
const [authHost, authPortText] = AUTH_HOST.split(":");
const firestorePort = Number(firestorePortText || 8080);
const authUrl = `http://${authHost}:${Number(authPortText || 9099)}`;

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
  const client = makeClient(`claim-${brandId}`);
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

test("P0-FINAL-1D-A2-1 rules: org_structure and restore snapshots are same-brand readable but Browser-write locked", async () => {
  await adminDb.recursiveDelete(adminDb.collection("brands"));
  await adminDb.recursiveDelete(adminDb.collection("artifacts"));

  await adminDb.doc("brands/anniu/settings/org_structure").set({
    managers: { 一區: ["安妞A店"], 未分配: [] },
    managerOrder: ["一區", "未分配"],
  });
  await adminDb.doc("brands/anniu/org_structure_snapshots/s1").set({
    brandId: "anniu",
    managers: { 一區: ["安妞A店"], 未分配: [] },
  });
  await adminDb.doc("artifacts/default-app-id/public/data/global_settings/org_structure").set({
    managers: { 北區: ["CYJA店"], 未分配: [] },
    managerOrder: ["北區", "未分配"],
  });
  await adminDb.doc("artifacts/default-app-id/public/data/org_structure_snapshots/s1").set({
    brandId: "cyj",
    managers: { 北區: ["CYJA店"], 未分配: [] },
  });

  const anniu = await createClaimedUser({ brandId: "anniu", accountId: "anniu-director" });
  await expectAllowed(
    getDoc(doc(anniu.db, "brands", "anniu", "settings", "org_structure")),
    "anniu org_structure read"
  );
  await expectAllowed(
    getDoc(doc(anniu.db, "brands", "anniu", "org_structure_snapshots", "s1")),
    "anniu snapshot read"
  );
  await expectDenied(
    setDoc(doc(anniu.db, "brands", "anniu", "settings", "org_structure"), {
      managers: { 一區: ["安妞B店"], 未分配: [] },
    }, { merge: true }),
    "anniu org_structure Browser write"
  );
  await expectDenied(
    setDoc(doc(anniu.db, "brands", "anniu", "org_structure_snapshots", "forged"), {
      brandId: "anniu",
      managers: { 一區: ["安妞B店"], 未分配: [] },
    }),
    "anniu snapshot Browser write"
  );
  await expectDenied(
    getDoc(doc(anniu.db, "artifacts", "default-app-id", "public", "data", "global_settings", "org_structure")),
    "anniu cross-brand CYJ org_structure read"
  );

  const cyj = await createClaimedUser({ brandId: "cyj", accountId: "cyj-director" });
  await expectAllowed(
    getDoc(doc(cyj.db, "artifacts", "default-app-id", "public", "data", "global_settings", "org_structure")),
    "CYJ org_structure read"
  );
  await expectAllowed(
    getDoc(doc(cyj.db, "artifacts", "default-app-id", "public", "data", "org_structure_snapshots", "s1")),
    "CYJ snapshot read"
  );
  await expectDenied(
    setDoc(doc(cyj.db, "artifacts", "default-app-id", "public", "data", "global_settings", "org_structure"), {
      managers: { 北區: ["CYJB店"], 未分配: [] },
    }, { merge: true }),
    "CYJ org_structure Browser write"
  );
  await expectDenied(
    setDoc(doc(cyj.db, "artifacts", "default-app-id", "public", "data", "org_structure_snapshots", "forged"), {
      brandId: "cyj",
      managers: { 北區: ["CYJB店"], 未分配: [] },
    }),
    "CYJ snapshot Browser write"
  );
  await expectDenied(
    getDoc(doc(cyj.db, "brands", "anniu", "settings", "org_structure")),
    "CYJ cross-brand anniu org_structure read"
  );

  await cleanupClient(cyj);
  await cleanupClient(anniu);
});

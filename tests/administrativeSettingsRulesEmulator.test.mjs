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
  const client = makeClient(`admin-${brandId}`);
  const email = `${brandId}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
  const password = "rules-test-Password-123!";
  const credential = await createUserWithEmailAndPassword(client.auth, email, password);
  await admin.auth().setCustomUserClaims(credential.user.uid, {
    drcyjIdentity: true,
    identityVersion: "application-identity-v1",
    brandId,
    roleId: "director",
    accountId,
    directorLevel: "super_admin",
  });
  await signOut(client.auth);
  await signInWithEmailAndPassword(client.auth, email, password);
  await client.auth.currentUser.getIdToken(true);
  return client;
}

test("P0-FINAL-1D-A1 emulator: admin setting reads remain available but browser writes are denied", async () => {
  let anniu = null;
  let cyj = null;

  try {
    await adminDb.recursiveDelete(adminDb.collection("brands"));
    await adminDb.recursiveDelete(adminDb.collection("artifacts"));

    await adminDb.doc("brands/anniu/settings/security_config").set({ revision: 1, autoLogoutEnabled: true });
  await adminDb.doc("brands/anniu/settings/feature_flags").set({ revision: 1, therapistModuleEnabled: true });
  await adminDb.doc("brands/anniu/settings/kpi_targets").set({ revision: 1, trafficASP: 1200 });
  await adminDb.doc("brands/anniu/settings/other_setting").set({ value: 1 });

  await adminDb.doc("artifacts/default-app-id/public/data/global_settings/security_config").set({ revision: 1 });
  await adminDb.doc("artifacts/default-app-id/public/data/global_settings/feature_flags").set({ revision: 1 });
  await adminDb.doc("artifacts/default-app-id/public/data/global_settings/kpi_targets").set({ revision: 1 });
  await adminDb.doc("artifacts/default-app-id/public/data/global_settings/system_version").set({ version: "3.6.0" });
  await adminDb.doc("artifacts/default-app-id/public/data/global_settings/other_setting").set({ value: 1 });

    anniu = await createClaimedUser({ brandId: "anniu", accountId: "anniu-admin" });
  await expectAllowed(getDoc(doc(anniu.db, "brands", "anniu", "settings", "security_config")), "anniu security read");
  await expectAllowed(getDoc(doc(anniu.db, "brands", "anniu", "settings", "feature_flags")), "anniu feature read");
  await expectAllowed(getDoc(doc(anniu.db, "brands", "anniu", "settings", "kpi_targets")), "anniu KPI read");

  await expectDenied(setDoc(doc(anniu.db, "brands", "anniu", "settings", "security_config"), { changed: true }, { merge: true }), "anniu security browser write");
  await expectDenied(setDoc(doc(anniu.db, "brands", "anniu", "settings", "feature_flags"), { changed: true }, { merge: true }), "anniu feature browser write");
  await expectDenied(setDoc(doc(anniu.db, "brands", "anniu", "settings", "kpi_targets"), { changed: true }, { merge: true }), "anniu KPI browser write");
  await expectAllowed(setDoc(doc(anniu.db, "brands", "anniu", "settings", "other_setting"), { value: 2 }, { merge: true }), "anniu unrelated compatibility setting");

  await expectDenied(
    setDoc(doc(anniu.db, "artifacts", "default-app-id", "public", "data", "global_settings", "system_version"), { version: "9.9.9" }, { merge: true }),
    "anniu global system version write"
  );

    cyj = await createClaimedUser({ brandId: "cyj", accountId: "cyj-admin" });
  await expectAllowed(getDoc(doc(cyj.db, "artifacts", "default-app-id", "public", "data", "global_settings", "security_config")), "CYJ security read");
  await expectAllowed(getDoc(doc(cyj.db, "artifacts", "default-app-id", "public", "data", "global_settings", "feature_flags")), "CYJ feature read");
  await expectAllowed(getDoc(doc(cyj.db, "artifacts", "default-app-id", "public", "data", "global_settings", "kpi_targets")), "CYJ KPI read");
  await expectAllowed(getDoc(doc(cyj.db, "artifacts", "default-app-id", "public", "data", "global_settings", "system_version")), "CYJ system version read");

  await expectDenied(setDoc(doc(cyj.db, "artifacts", "default-app-id", "public", "data", "global_settings", "security_config"), { changed: true }, { merge: true }), "CYJ security browser write");
  await expectDenied(setDoc(doc(cyj.db, "artifacts", "default-app-id", "public", "data", "global_settings", "feature_flags"), { changed: true }, { merge: true }), "CYJ feature browser write");
  await expectDenied(setDoc(doc(cyj.db, "artifacts", "default-app-id", "public", "data", "global_settings", "kpi_targets"), { changed: true }, { merge: true }), "CYJ KPI browser write");
  await expectDenied(setDoc(doc(cyj.db, "artifacts", "default-app-id", "public", "data", "global_settings", "system_version"), { version: "9.9.9" }, { merge: true }), "CYJ system version browser write");
  await expectAllowed(setDoc(doc(cyj.db, "artifacts", "default-app-id", "public", "data", "global_settings", "other_setting"), { value: 2 }, { merge: true }), "CYJ unrelated compatibility setting");

  } finally {
    if (anniu) await cleanupClient(anniu);
    if (cyj) await cleanupClient(cyj);
  }
});

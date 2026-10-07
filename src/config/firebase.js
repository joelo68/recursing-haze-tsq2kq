// src/config/firebase.js
import { initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth } from "firebase/auth";
import { connectFirestoreEmulator, getFirestore, initializeFirestore } from "firebase/firestore";
import { shouldForceFirestoreLongPollingForCurrentBrowser } from "../utils/firestoreTransport";
import { ACTIVITY_SALES_DEV_MODE, ACTIVITY_SALES_RUNTIME } from "./runtimeEnvironment";

// --- Firebase Config ---
const originalConfig = {
  apiKey: "AIzaSyDqeHT2J9Z69k88-clPwKyuywg1TSpojYM",
  authDomain: "cyjsituation-analysis.firebaseapp.com",
  projectId: "cyjsituation-analysis",
  storageBucket: "cyjsituation-analysis.firebasestorage.app",
  messagingSenderId: "139860745126",
  appId: "1:139860745126:web:4539176a4cf73ae4480d67",
  measurementId: "G-L9DVME64VK",
};

const activitySalesDemoConfig = {
  apiKey: "demo-api-key",
  authDomain: `${ACTIVITY_SALES_RUNTIME.projectId}.firebaseapp.com`,
  projectId: ACTIVITY_SALES_RUNTIME.projectId,
  storageBucket: `${ACTIVITY_SALES_RUNTIME.projectId}.appspot.com`,
  messagingSenderId: "000000000000",
  appId: "1:000000000000:web:activity-sales-local",
};

// Production keeps the existing config resolution untouched.
// Activity Sales local mode never receives the Production Firebase project config.
const firebaseConfig = ACTIVITY_SALES_DEV_MODE
  ? activitySalesDemoConfig
  : typeof window !== "undefined" && window.__firebase_config
    ? JSON.parse(window.__firebase_config)
    : typeof __firebase_config !== "undefined"
    ? JSON.parse(__firebase_config)
    : originalConfig;

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const forceLongPolling = shouldForceFirestoreLongPollingForCurrentBrowser();
const db = forceLongPolling
  ? initializeFirestore(app, {
      // iPhone / iPad WebKit compatibility:
      // the default WebChannel path can delay server-backed Firestore delivery.
      experimentalForceLongPolling: true,
    })
  : getFirestore(app);

if (ACTIVITY_SALES_DEV_MODE) {
  connectAuthEmulator(auth, ACTIVITY_SALES_RUNTIME.authEmulatorUrl, {
    disableWarnings: true,
  });
  connectFirestoreEmulator(
    db,
    ACTIVITY_SALES_RUNTIME.firestoreEmulatorHost,
    ACTIVITY_SALES_RUNTIME.firestoreEmulatorPort
  );

  console.warn(
    `[Activity Sales DEV] LOCAL DEMO ONLY — project=${ACTIVITY_SALES_RUNTIME.projectId}`
  );
}

// 處理 appId 邏輯
const rawAppId =
  typeof window !== "undefined" && window.__app_id
    ? window.__app_id
    : typeof __app_id !== "undefined"
    ? __app_id
    : "default-app-id";
    
const appId = rawAppId.replace(/\//g, "_");

export { app, auth, db, appId };
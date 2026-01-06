// src/config/firebase.js
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

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

// 處理全域變數注入的情況
const firebaseConfig =
  typeof window !== "undefined" && window.__firebase_config
    ? JSON.parse(window.__firebase_config)
    : typeof __firebase_config !== "undefined"
    ? JSON.parse(__firebase_config)
    : originalConfig;

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// 處理 appId 邏輯
const rawAppId =
  typeof window !== "undefined" && window.__app_id
    ? window.__app_id
    : typeof __app_id !== "undefined"
    ? __app_id
    : "default-app-id";
    
const appId = rawAppId.replace(/\//g, "_");

export { app, auth, db, appId };
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

const app = read("src/App.jsx");
const managerView = read("src/components/TherapistManagerView.jsx");
const settings = read("src/components/SettingsView.jsx");
const backend = read("functions/therapistMasterAuthority.js");
const rules = read("firestore.rules");

const sliceBetween = (source, startText, endText) => {
  const start = source.indexOf(startText);
  const end = source.indexOf(endText, start + startText.length);
  assert.ok(start >= 0 && end > start, `${startText} block must exist`);
  return source.slice(start, end);
};

test("B1C2C2 therapist manager uses backend authority for every master mutation", () => {
  assert.match(app, /THERAPIST_MASTER_ENDPOINT\s*=\s*"https:\/\/us-central1-cyjsituation-analysis\.cloudfunctions\.net\/manageTherapistMaster"/);
  assert.match(app, /const manageTherapistMasterAction = useCallback/);
  assert.match(managerView, /action:\s*"create"/);
  assert.match(managerView, /action:\s*"update"/);
  assert.match(managerView, /action,\s*therapistId:\s*t\.id/);
  assert.match(managerView, /action:\s*"delete"/);
  assert.match(managerView, /confirmPermanentDelete:\s*true/);
  assert.match(managerView, /expectedMasterSignature:\s*selectedTherapist\.masterSignature/);
  assert.match(managerView, /expectedMasterSignature:\s*t\.masterSignature/);
  assert.doesNotMatch(managerView, /firebase\/firestore|setDoc\(|updateDoc\(|deleteDoc\(/);
});

test("therapist manager browser no longer displays searches edits or submits stored passwords", () => {
  assert.doesNotMatch(managerView, /\.password|formPassword|showPassword|resetPassword/);
  assert.doesNotMatch(managerView, /credentialPassword|currentPassword|newPassword/);
  assert.match(managerView, /此頁不顯示、搜尋或修改任何登入密碼/);
  assert.match(managerView, /初次登入將使用系統初始密碼並要求更新/);
  assert.doesNotMatch(managerView, /payload:[\s\S]{0,300}password/);
});

test("therapist admin list comes from same-brand backend sanitized master directory with signatures", () => {
  assert.match(backend, /SUPPORTED_THERAPIST_MASTER_ACTIONS[\s\S]{0,180}"list"/);
  assert.match(backend, /if \(action === "list"\)/);
  assert.match(backend, /sanitizeTherapistResponse\(masterRaw\)/);
  assert.match(backend, /masterSignature:\s*buildTherapistMasterSignature\(masterRaw\)/);
  assert.match(app, /callTherapistMasterAuthority\(\{ action: "list" \}\)/);
  assert.match(app, /result\?\.brandId[\s\S]{0,240}brandIdAtStart/);
  assert.match(app, /currentBrandIdRef\.current === result\.brandIdAtStart/);
  assert.doesNotMatch(app, /getDocs\(getCollectionPath\("therapists"\)\)/);
});

test("OCC conflicts refresh signed rows and never auto-overwrite a concurrent manager change", () => {
  assert.match(app, /error\?\.status === 409[\s\S]{0,300}refreshTherapistMasterDirectory/);
  assert.match(managerView, /therapist_master_conflict/);
  assert.match(managerView, /refreshedSelected\.masterSignature[\s\S]{0,220}selectedTherapist\.masterSignature/);
  assert.match(managerView, /setSelectedTherapist\(refreshedSelected\)[\s\S]{0,120}loadTherapistToForm\(refreshedSelected\)/);
  assert.match(backend, /assertExpectedMasterSignature\(expectedMasterSignature, currentRaw\)/);
  assert.doesNotMatch(app, /currentMasterSignature[\s\S]{0,220}manageTherapistMasterAction/);
});

test("disabled Settings therapist writer is retired instead of preserved as a hidden bypass", () => {
  assert.doesNotMatch(settings, /therapists_DISABLED/);
  assert.doesNotMatch(settings, /getCollectionPath\("therapists"\)/);
  assert.doesNotMatch(settings, /handleAddTherapist|handleUpdateTherapist|handleDeleteTherapist/);
});

test("B1C2C2 preserves Rules and credential migration boundary", () => {
  assert.match(rules, /function signedIn\(\)\s*\{\s*return request\.auth != null;/);
  assert.match(app, /CURRENT_APP_VERSION\s*=\s*"3\.6\.0"/);
  assert.doesNotMatch(backend, /migrateTherapistCredential/);
  assert.doesNotMatch(app, /therapist_credentials/);
  assert.doesNotMatch(managerView, /therapist_credentials/);
});

test("therapist master loading is one-shot page hydration without listener or polling", () => {
  const start = app.indexOf("const refreshTherapistMasterDirectory");
  const end = app.indexOf("const updateModulePermissions", start);
  assert.ok(start >= 0 && end > start);
  const block = app.slice(start, end);
  assert.match(block, /action:\s*"list"/);
  assert.doesNotMatch(block, /onSnapshot\s*\(|setInterval\s*\(|setTimeout\s*\(/);
});

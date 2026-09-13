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
  assert.match(managerView, /action,\s*therapistId:\s*target\.id/);
  assert.match(managerView, /action:\s*"delete"/);
  assert.match(managerView, /action:\s*"reset_password"/);
  assert.match(managerView, /action:\s*"get"/);
  assert.match(managerView, /confirmPermanentDelete:\s*true/);
  assert.match(managerView, /expectedMasterSignature:\s*selectedTherapist\.masterSignature/);
  assert.match(managerView, /expectedMasterSignature:\s*target\.masterSignature/);
  assert.doesNotMatch(managerView, /firebase\/firestore|setDoc\(|updateDoc\(|deleteDoc\(/);
});

test("therapist manager never reveals stored passwords and forgotten-password recovery is backend reset only", () => {
  assert.doesNotMatch(managerView, /\.password|formPassword|showPassword/);
  assert.doesNotMatch(managerView, /credentialPassword|currentPassword|newPassword/);
  assert.match(managerView, /此頁不顯示、搜尋或直接編輯任何登入密碼/);
  assert.match(managerView, /忘記密碼時，可由最高管理者重設為系統初始密碼/);
  assert.match(managerView, /action:\s*"reset_password"/);
  assert.match(managerView, /重設登入密碼/);
  assert.doesNotMatch(managerView, /payload:[\s\S]{0,300}password/);
});

test("therapist manager opens from existing sanitized login directory and fetches only the selected master document", () => {
  assert.match(backend, /SUPPORTED_THERAPIST_MASTER_ACTIONS[\s\S]{0,220}"get"/);
  assert.match(backend, /if \(action === "get"\)/);
  assert.match(backend, /therapistRef\.get\(\)/);
  assert.match(backend, /readCount:\s*1/);
  assert.match(backend, /sanitizeTherapistResponse\(masterRaw\)/);
  assert.match(backend, /masterSignature:\s*buildTherapistMasterSignature\(masterRaw\)/);
  assert.match(app, /管師帳號直接使用登入時已取得的 sanitized directory/);
  assert.match(app, /const refreshTherapistMasterRecord = useCallback/);
  assert.match(app, /action:\s*"get"/);
  assert.match(app, /admin_therapist_master_record_backend/);
  assert.doesNotMatch(app, /callTherapistMasterAuthority\(\{ action: "list" \}\)/);
  assert.doesNotMatch(app, /admin_therapist_master_backend/);
  assert.doesNotMatch(app, /getDocs\(getCollectionPath\("therapists"\)\)/);
});

test("OCC conflicts refresh only the selected therapist and never auto-overwrite a concurrent manager change", () => {
  assert.match(app, /error\?\.status === 409[\s\S]{0,420}refreshTherapistMasterRecord\(therapistId\)/);
  assert.match(managerView, /therapist_master_conflict/);
  assert.match(managerView, /refreshedSelected\.masterSignature[\s\S]{0,220}selectedTherapist\.masterSignature/);
  assert.match(managerView, /setSelectedTherapist\(refreshedSelected\)[\s\S]{0,120}loadTherapistToForm\(refreshedSelected\)/);
  assert.match(backend, /assertExpectedMasterSignature\(expectedMasterSignature, currentRaw\)/);
  assert.doesNotMatch(app, /refreshTherapistMasterDirectory/);
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

test("therapist manager page adds no collection hydration, listener or polling", () => {
  const start = app.indexOf("const refreshTherapistMasterRecord");
  const end = app.indexOf("const manageApplicationAccountAction", start);
  assert.ok(start >= 0 && end > start);
  const block = app.slice(start, end);
  assert.match(block, /action:\s*"get"/);
  assert.match(block, /trackReadSource\([\s\S]{0,120}"admin_therapist_master_record_backend"[\s\S]{0,120}1/);
  assert.doesNotMatch(block, /action:\s*"list"/);
  assert.doesNotMatch(block, /onSnapshot\s*\(|setInterval\s*\(|setTimeout\s*\(/);
});

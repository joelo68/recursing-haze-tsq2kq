import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), "utf8");

const app = read("src/App.jsx");
const managerView = read("src/components/TherapistManagerView.jsx");
const masterAuthority = read("functions/therapistMasterAuthority.js");
const credentialAuthority = read("functions/therapistCredentialAuthority.js");
const applicationIdentity = read("functions/applicationIdentity.js");
const rules = read("firestore.rules");

test("therapist manager opens from sanitized directory without page-entry therapist collection hydration", () => {
  assert.match(app, /管師帳號直接使用登入時已取得的 sanitized directory/);
  assert.match(app, /setAdminCredentialSourceState\(\{ status: "ready", brandId, view: "therapist-manager"/);
  assert.doesNotMatch(app, /const refreshTherapistMasterDirectory/);
  assert.doesNotMatch(app, /callTherapistMasterAuthority\(\{ action: "list" \}\)/);
  assert.doesNotMatch(app, /admin_therapist_master_backend/);
});

test("selected therapist detail is one backend point read and OCC conflict refresh stays single-record", () => {
  assert.match(masterAuthority, /if \(action === "get"\)/);
  assert.match(masterAuthority, /const therapistSnap = await therapistRef\.get\(\)/);
  assert.match(masterAuthority, /readCount:\s*1/);
  assert.match(app, /const refreshTherapistMasterRecord = useCallback/);
  assert.match(app, /action:\s*"get"/);
  assert.match(app, /admin_therapist_master_record_backend/);
  assert.match(app, /error\?\.status === 409[\s\S]{0,500}refreshTherapistMasterRecord\(therapistId\)/);
  assert.doesNotMatch(app, /error\?\.status === 409[\s\S]{0,500}action:\s*"list"/);
});

test("forgotten-password recovery resets authority source without exposing any stored therapist password", () => {
  assert.match(managerView, /重設登入密碼/);
  assert.match(managerView, /action:\s*"reset_password"/);
  assert.match(managerView, /系統初始密碼重新登入並設定新密碼/);
  assert.doesNotMatch(managerView, /\.password|credentialPassword|currentPassword|newPassword/);

  assert.match(masterAuthority, /resetTherapistCredentialPasswordInTransaction/);
  assert.match(masterAuthority, /getInitialPasswordsForRole\("therapist", brandId\)/);
  assert.match(masterAuthority, /requiresInitialPasswordChange:\s*true/);
  assert.match(credentialAuthority, /if \(source\.mode === THERAPIST_CREDENTIAL_STORAGE_MODE_EMBEDDED\)/);
  assert.match(credentialAuthority, /transaction\.set\(source\.credentialRef/);
  assert.doesNotMatch(masterAuthority, /migrateTherapistCredentialInTransaction/);
});

test("sanitized directory carries roster display fields but not credential material", () => {
  const start = applicationIdentity.indexOf("function normalizeTherapistDirectoryRecord");
  const end = applicationIdentity.indexOf("function buildSanitizedLoginDirectory", start);
  assert.ok(start >= 0 && end > start);
  const block = applicationIdentity.slice(start, end);
  assert.match(block, /onboardDate:/);
  assert.match(block, /resignDate:/);
  assert.match(block, /isActive:/);
  assert.doesNotMatch(block, /password|credentialStorageMode|secret|token/i);
});

test("optimization adds no listener polling collection query Rules change or credential migration", () => {
  const start = app.indexOf("const refreshTherapistMasterRecord");
  const end = app.indexOf("const manageApplicationAccountAction", start);
  assert.ok(start >= 0 && end > start);
  const block = app.slice(start, end);
  assert.doesNotMatch(block, /onSnapshot\s*\(|setInterval\s*\(|setTimeout\s*\(|getDocs\s*\(/);
  assert.doesNotMatch(managerView, /firebase\/firestore|onSnapshot\s*\(|setInterval\s*\(|setTimeout\s*\(/);
  assert.match(rules, /match \/brands\/\{brandId\}\/therapist_credentials\/\{document=\*\*\}[\s\S]{0,100}allow read, write: if false;/);
  assert.match(rules, /match \/artifacts\/\{appId\}\/public\/data\/therapist_credentials\/\{document=\*\*\}[\s\S]{0,100}allow read, write: if false;/);
  assert.match(app, /CURRENT_APP_VERSION\s*=\s*"3\.6\.0"/);
});

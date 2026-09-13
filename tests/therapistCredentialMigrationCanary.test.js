import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

const indexSource = read("functions/index.js");
const masterAuthority = read("functions/therapistMasterAuthority.js");
const credentialAuthority = read("functions/therapistCredentialAuthority.js");
const app = read("src/App.jsx");
const managerView = read("src/components/TherapistManagerView.jsx");
const rules = read("firestore.rules");

test("migration canary reuses the existing secured manageTherapistMaster endpoint and exposes no standalone migration function", () => {
  assert.match(masterAuthority, /"migrate_credential"/);
  assert.match(masterAuthority, /migrateTherapistCredentialInTransaction/);
  assert.match(masterAuthority, /confirmCredentialMigration/);
  assert.match(masterAuthority, /verifySuperAdminActor/);
  assert.match(masterAuthority, /assertAdminApplicationClaims/);
  assert.match(masterAuthority, /expectedMasterSignature/);
  assert.doesNotMatch(indexSource, /exports\.(?:migrateTherapistCredential|auditTherapistCredential)/);
  assert.match(indexSource, /exports\.manageTherapistMaster\s*=\s*therapistMasterAuthorityFunctions\.manageTherapistMaster/);
});

test("migration canary is exact-document, brand-resolved and has no listener query or polling surface", () => {
  assert.match(credentialAuthority, /getTherapistCredentialRefs/);
  assert.match(credentialAuthority, /getBrandCollection\(db, safeBrandId, "therapists"\)\.doc\(safeTherapistId\)/);
  assert.match(credentialAuthority, /getBrandCollection\(db, safeBrandId, "therapist_credentials"\)\.doc\(safeTherapistId\)/);
  assert.doesNotMatch(masterAuthority, /onSnapshot\s*\(|setInterval\s*\(|setTimeout\s*\(/);
  assert.doesNotMatch(credentialAuthority, /onSnapshot\s*\(|setInterval\s*\(|setTimeout\s*\(/);
  assert.doesNotMatch(masterAuthority, /\.where\s*\(|\.limit\s*\(/);
});

test("migration canary keeps therapist_credentials backend-only and leaves app version unchanged", () => {
  assert.match(rules, /match \/brands\/\{brandId\}\/therapist_credentials\/\{document=\*\*\}[\s\S]{0,100}allow read, write: if false;/);
  assert.match(rules, /match \/artifacts\/\{appId\}\/public\/data\/therapist_credentials\/\{document=\*\*\}[\s\S]{0,100}allow read, write: if false;/);
  assert.match(app, /CURRENT_APP_VERSION\s*=\s*"3\.6\.0"/);
});

test("frontend exposes a plain-language single-account safety upgrade without direct credential access", () => {
  assert.match(managerView, /升級帳號安全/);
  assert.match(managerView, /只移動目前密碼的保存位置，不會更改密碼，也不會改動人員資料/);
  assert.match(managerView, /action:\s*"migrate_credential"/);
  assert.match(managerView, /confirmCredentialMigration:\s*true/);
  assert.match(app, /confirmCredentialMigration:\s*confirmCredentialMigration === true/);
  assert.match(app, /credentialStorageMode:\s*String\(result\.credentialStorageMode \|\| ""\)/);
  assert.doesNotMatch(managerView, /firebase\/firestore|therapist_credentials/);
});

test("migration canary refreshes the exact therapist OCC token immediately before the sensitive write", () => {
  assert.match(managerView, /loadTherapistDetail = async \(t, \{ openDrawer = false, forceRefresh = false \} = \{\}\)/);
  assert.match(managerView, /if \(t\.masterSignature && !forceRefresh\) return t;/);

  const start = managerView.indexOf("const handleUpgradeTherapistCredential");
  const end = managerView.indexOf("const openCredentialReveal", start);
  assert.ok(start >= 0 && end > start);
  const block = managerView.slice(start, end);

  assert.match(block, /loadTherapistDetail\(t, \{ openDrawer: true, forceRefresh: true \}\)/);
  assert.match(block, /action:\s*"migrate_credential"/);
  assert.match(block, /expectedMasterSignature:\s*target\.masterSignature/);
  assert.doesNotMatch(block, /if \(!target\.masterSignature \|\| !target\.credentialStorageMode\)/);
});

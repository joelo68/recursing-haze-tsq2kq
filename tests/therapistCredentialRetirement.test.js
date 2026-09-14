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
const accountAuthority = read("functions/accountAuthority.js");
const deviceApproval = read("functions/deviceApproval.js");
const app = read("src/App.jsx");
const managerView = read("src/components/TherapistManagerView.jsx");
const maintenance = read("src/components/SystemMaintenance.jsx");
const rules = read("firestore.rules");

test("legacy therapist credential migration actions and rollout UI are fully retired", () => {
  assert.doesNotMatch(masterAuthority, /migrate_credential|credential_migration_inventory|confirmCredentialMigration|migrateTherapistCredentialInTransaction/);
  assert.doesNotMatch(app, /confirmCredentialMigration/);
  assert.doesNotMatch(managerView, /migrate_credential|升級帳號安全|confirmCredentialMigration/);
  assert.doesNotMatch(maintenance, /credential_migration_inventory|migrate_credential|管理師帳號安全升級|confirmCredentialMigration/);
});

test("credential authority accepts separated_v1 only and legacy markers fail closed", () => {
  assert.match(credentialAuthority, /THERAPIST_CREDENTIAL_STORAGE_MODE_SEPARATED\s*=\s*"separated_v1"/);
  assert.match(credentialAuthority, /RETIRED_LEGACY_STORAGE_MODES/);
  assert.match(credentialAuthority, /legacy_credential_retired/);
  assert.doesNotMatch(credentialAuthority, /buildEmbeddedCredentialCreateFields|migrateTherapistCredentialInTransaction|migratedFrom\s*:\s*"therapists\.password"/);
  assert.match(credentialAuthority, /transaction\.set\(source\.credentialRef/);
  assert.doesNotMatch(credentialAuthority, /transaction\.set\(source\.therapistRef[\s\S]{0,180}password/);
});

test("login, self password change and admin password operations keep using the shared separated credential authority", () => {
  assert.match(deviceApproval, /loadTherapistCredentialSource/);
  assert.match(accountAuthority, /loadTherapistCredentialSource/);
  assert.match(accountAuthority, /updateTherapistCredentialPasswordInTransaction/);
  assert.match(masterAuthority, /resetTherapistCredentialPasswordInTransaction/);
  assert.doesNotMatch(accountAuthority, /therapists\.password/);
});

test("frontend has no direct therapist credential collection access and manager fails closed on non-separated records", () => {
  assert.doesNotMatch(app, /therapist_credentials/);
  assert.doesNotMatch(managerView, /therapist_credentials|firebase\/firestore/);
  assert.doesNotMatch(maintenance, /therapist_credentials/);
  assert.match(managerView, /selectedCredentialMode\s*===\s*"separated_v1"/);
  assert.match(managerView, /登入安全資料需要管理者檢查/);
});

test("Rules remain backend-only for both physical therapist credential roots", () => {
  assert.match(rules, /match \/brands\/\{brandId\}\/therapist_credentials\/\{document=\*\*\}[\s\S]{0,120}allow read, write: if false;/);
  assert.match(rules, /match \/artifacts\/\{appId\}\/public\/data\/therapist_credentials\/\{document=\*\*\}[\s\S]{0,120}allow read, write: if false;/);
  assert.match(rules, /match \/brands\/\{brandId\}\/therapists\/\{document=\*\*\}[\s\S]{0,160}allow write: if false;/);
  assert.match(rules, /match \/artifacts\/\{appId\}\/public\/data\/therapists\/\{document=\*\*\}[\s\S]{0,160}allow write: if false;/);
});

test("retirement adds no listener, polling, standalone migration function or app-version change", () => {
  for (const source of [masterAuthority, credentialAuthority]) {
    assert.doesNotMatch(source, /onSnapshot\s*\(|setInterval\s*\(|setTimeout\s*\(/);
  }
  assert.doesNotMatch(indexSource, /exports\.(?:migrateTherapistCredential|auditTherapistCredential)/);
  assert.match(indexSource, /exports\.manageTherapistMaster\s*=\s*therapistMasterAuthorityFunctions\.manageTherapistMaster/);
  assert.match(indexSource, /exports\.changeApplicationPassword\s*=\s*accountAuthorityFunctions\.changeApplicationPassword/);
  assert.match(indexSource, /exports\.manageApplicationAccount\s*=\s*accountAuthorityFunctions\.manageApplicationAccount/);
  assert.match(app, /CURRENT_APP_VERSION\s*=\s*"3\.6\.0"/);
});

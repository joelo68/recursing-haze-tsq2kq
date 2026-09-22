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
const settings = read("src/components/SettingsView.jsx");
const therapistManager = read("src/components/TherapistManagerView.jsx");
const backend = read("functions/accountAuthority.js");
const rules = read("firestore.rules");

const sliceBetween = (source, startText, endText) => {
  const start = source.indexOf(startText);
  const end = source.indexOf(endText, start + startText.length);
  assert.ok(start >= 0 && end > start, `${startText} block must exist`);
  return source.slice(start, end);
};

test("admin settings no longer hydrate credential-bearing documents", () => {
  const block = sliceBetween(app, "Admin Credential Writer Retirement", "const targetYearStr = String(selectedYear)");
  for (const sourceName of ["director_auth", "trainer_auth", "manager_auth", "store_account_data", "master_auth"]) {
    assert.doesNotMatch(block, new RegExp(`getDoc\\(getDocPath\\(\\"${sourceName}\\"\\)\\)`));
  }
  assert.match(block, /loginDirectory\?\.brandId === brandId/);
  assert.doesNotMatch(block, /getDocs\s*\(|onSnapshot\s*\(|setInterval\s*\(|setTimeout\s*\(/);
});

test("Settings uses backend authorities instead of direct credential writers", () => {
  for (const sourceName of ["director_auth", "trainer_auth", "manager_auth", "store_account_data"]) {
    assert.doesNotMatch(settings, new RegExp(`setDoc\\(getDocPath\\(\\"${sourceName}\\"\\)`));
    assert.doesNotMatch(settings, new RegExp(`getDoc\\(getDocPath\\(\\"${sourceName}\\"\\)`));
  }
  assert.match(settings, /manageApplicationAccountAction/);
  assert.match(settings, /manageManagerOrganizationAction/);
  assert.match(settings, /action:\s*"reset_password"/);
  assert.match(settings, /action:\s*"reveal_password"/);
  assert.doesNotMatch(settings, /account\.password|managerAuth\[/);
});

test("credential reveal is explicit single-account backend action without listener query or polling", () => {
  assert.match(backend, /CREDENTIAL_REVEAL_ACTION\s*=\s*"reveal_password"/);
  assert.match(backend, /revealManagedCredentialInTransaction/);
  assert.match(backend, /getBrandSettingDoc\(db, brandId, "master_auth"\)/);
  assert.match(backend, /loadTherapistCredentialSource/);
  assert.match(backend, /activityType:\s*"auth\.credential_reveal"/);
  assert.match(backend, /Cache-Control",\s*"private, no-store"/);
  assert.doesNotMatch(backend, /onSnapshot\s*\(|setInterval\s*\(|setTimeout\s*\(|collectionGroup\s*\(/);
});

test("password reveal requires highest management key and personal super-admin session", () => {
  assert.match(backend, /if \(action === CREDENTIAL_REVEAL_ACTION\)/);
  assert.match(backend, /master_management_key_required/);
  assert.match(backend, /assertMasterManagementKey\(masterSnap\.data\(\) \|\| \{\}, managementKey\)/);
  assert.match(backend, /actorCheck\?\.isMasterCredential === true/);
  assert.match(backend, /personal_super_admin_login_required/);
});

test("therapist reveal follows authoritative embedded or separated credential source", () => {
  assert.match(therapistManager, /manageApplicationAccountAction/);
  assert.match(therapistManager, /roleId:\s*"therapist"/);
  assert.match(therapistManager, /action:\s*"reveal_password"/);
  assert.doesNotMatch(therapistManager, /firebase\/firestore|therapist_credentials/);
  assert.match(therapistManager, /action:\s*"reset_password"/);
});

test("browser access to all admin credential documents is denied on both path families", () => {
  for (const name of ["director_auth", "trainer_auth", "manager_auth", "store_account_data"]) {
    assert.match(rules, new RegExp(`match \\/brands\\/\\{brandId\\}\\/settings\\/${name}\\s*\\{\\s*allow read, write:\\s*if false;`));
    assert.match(rules, new RegExp(`settingId != '${name}'`));
  }
  assert.match(
    rules,
    /match \/brands\/\{brandId\}\/settings\/\{settingId\}\/\{document=\*\*\}[\s\S]{0,1400}settingId != 'director_auth'[\s\S]{0,700}settingId != 'store_account_data'/,
  );
  assert.match(
    rules,
    /match \/brands\/\{brandId\}\/\{collectionName\}\/\{document=\*\*\}[\s\S]{0,1800}collectionName != 'settings'/,
  );
  assert.doesNotMatch(rules, /collectionName == 'settings' && document == 'director_auth'/);
});

test("read topology stays event/point-read only and app version is unchanged", () => {
  assert.match(app, /CURRENT_APP_VERSION\s*=\s*"3\.6\.0"/);
  assert.doesNotMatch(settings, /onSnapshot\s*\(|setInterval\s*\(|setTimeout\s*\(/);
  assert.doesNotMatch(therapistManager, /onSnapshot\s*\(|setInterval\s*\(|setTimeout\s*\(/);
  assert.match(settings, /最高管理金鑰/);
  assert.match(settings, /只會讀取這一個指定帳號/);
});

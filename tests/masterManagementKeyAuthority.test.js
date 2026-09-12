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
const maintenance = read("src/components/SystemMaintenance.jsx");
const backend = read("functions/accountAuthority.js");
const deviceApproval = read("functions/deviceApproval.js");
const rules = read("firestore.rules");

const sliceBetween = (source, startText, endText) => {
  const start = source.indexOf(startText);
  const end = source.indexOf(endText, start + startText.length);
  assert.ok(start >= 0 && end > start, `${startText} block must exist`);
  return source.slice(start, end);
};

test("高階主管帳號頁先驗證既有最高管理金鑰，金鑰只留在目前頁面記憶體", () => {
  assert.match(settings, /請先輸入最高管理金鑰/);
  assert.match(settings, /action:\s*"verify_master_key"/);
  assert.match(settings, /directorManagementKeyRef\.current\s*=\s*managementKey/);
  assert.match(settings, /managementKey:\s*directorManagementKeyRef\.current/);
  assert.match(settings, /lockDirectorManagement/);
  assert.equal(settings.includes("localStorage.setItem(\"managementKey"), false);
  assert.equal(settings.includes("sessionStorage.setItem(\"managementKey"), false);

  const directorBlock = sliceBetween(
    settings,
    'activeTab === "director-account"',
    'activeTab === "trainer-account"',
  );
  assert.match(directorBlock, /!directorManagementUnlocked/);
  assert.match(directorBlock, /type="password"/);
  assert.match(directorBlock, /變更最高管理金鑰/);
});

test("Frontend 使用既有 manageApplicationAccount endpoint，不建立第二套 key endpoint 或額外 listener", () => {
  assert.match(app, /const MANAGE_APPLICATION_ACCOUNT_ENDPOINT\s*=\s*"https:\/\/us-central1-cyjsituation-analysis\.cloudfunctions\.net\/manageApplicationAccount"/);
  const actionBlock = sliceBetween(app, "const manageApplicationAccountAction", "const updateModulePermissions");
  assert.match(actionBlock, /managementKey:\s*String\(managementKey \|\| ""\)/);
  assert.match(actionBlock, /\["verify_master_key", "change_master_key"\]\.includes\(safeAction\)/);
  assert.doesNotMatch(actionBlock, /onSnapshot\s*\(/);
  assert.doesNotMatch(actionBlock, /setInterval\s*\(/);
});

test("Backend verifies master_auth for page unlock and every director mutation, with transactional key change", () => {
  assert.match(backend, /MASTER_MANAGEMENT_KEY_ACTIONS/);
  assert.match(backend, /DIRECTOR_ACCOUNT_MUTATION_ACTIONS/);
  assert.match(backend, /assertMasterManagementKey/);
  assert.match(backend, /manageMasterManagementKeyInTransaction/);
  assert.match(backend, /master_management_key_required/);
  assert.match(backend, /personal_super_admin_login_required/);
  assert.match(backend, /activityType:\s*"auth\.master_management_key_change"/);

  const transactionBlock = sliceBetween(backend, "async function manageAccountInTransaction", "function createAccountAuthorityFunctions");
  assert.match(transactionBlock, /getBrandSettingDoc\(db, brandId, "master_auth"\)/);
  assert.match(transactionBlock, /assertMasterManagementKey\(masterSnap\.data\(\) \|\| \{\}, managementKey\)/);

  assert.match(deviceApproval, /getBrandSettingDoc\(db, brandId, 'master_auth'\)/);
  assert.match(deviceApproval, /isMasterCredential/);
});

test("Firestore Rules block browser access to master_auth for legacy and new-brand paths", () => {
  assert.match(
    rules,
    /match \/brands\/\{brandId\}\/settings\/master_auth\s*\{\s*allow read, write:\s*if false;/,
  );
  assert.match(rules, /allow read:\s*if signedIn\(\)\s*&& settingId != 'master_auth';/);
  assert.match(rules, /settingId != 'master_auth'/);
  assert.match(rules, /!\(collectionName == 'settings' && document == 'master_auth'\)/);
});

test("Browser maintenance backup no longer exports the highest management key", () => {
  const backupLine = maintenance.match(/const backupDocs\s*=\s*\[[^\]]*\]/)?.[0] || "";
  assert.ok(backupLine, "backupDocs must exist");
  assert.doesNotMatch(backupLine, /master_auth/);
  assert.match(maintenance, /master_auth 含最高管理金鑰/);
});

test("版本與部署邊界維持：不新增 Function export、不提高 CURRENT_APP_VERSION", () => {
  assert.match(app, /CURRENT_APP_VERSION\s*=\s*"3\.6\.0"/);
  assert.doesNotMatch(app, /MASTER_MANAGEMENT_KEY_ENDPOINT/);
});

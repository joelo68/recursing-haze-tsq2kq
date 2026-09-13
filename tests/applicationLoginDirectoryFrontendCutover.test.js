import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const app = read("src/App.jsx");
const login = read("src/components/LoginView.jsx");
const applicationIdentity = read("functions/applicationIdentity.js");
const rules = read("firestore.rules");

const sliceBetween = (source, startText, endText) => {
  const start = source.indexOf(startText);
  const end = source.indexOf(endText, start + startText.length);
  assert.ok(start >= 0 && end > start, `${startText} block must exist`);
  return source.slice(start, end);
};

test("B1C2C1 normal bootstrap uses sanitized directory instead of raw credential documents", () => {
  assert.match(app, /LOGIN_DIRECTORY_ENDPOINT\s*=\s*"https:\/\/us-central1-cyjsituation-analysis\.cloudfunctions\.net\/getApplicationLoginDirectory"/);
  assert.match(app, /callDeviceSecurityEndpoint\(LOGIN_DIRECTORY_ENDPOINT, \{ brandId: brandIdAtStart \}\)/);
  assert.match(app, /assertSanitizedLoginDirectory\(directoryResult\.directory, brandIdAtStart\)/);
  assert.match(app, /setLoginDirectory\(nextLoginDirectory\)/);

  const bootstrap = sliceBetween(app, "const fetchGlobalData", "const unsubReadTrackerConfig");
  for (const sourceName of ["store_account_data", "manager_auth", "trainer_auth", "director_auth", "master_auth"]) {
    assert.doesNotMatch(bootstrap, new RegExp(`getDoc\\(getDocPath\\(\"${sourceName}\"\\)\\)`));
  }
  assert.doesNotMatch(bootstrap, /getDocs\(getCollectionPath\("therapists"\)\)/);
});

test("sanitized therapist login directory includes non-secret roster fields needed for immediate manager rendering", () => {
  const therapistDirectoryBlock = sliceBetween(
    applicationIdentity,
    "function normalizeTherapistDirectoryRecord",
    "function buildSanitizedLoginDirectory"
  );
  assert.match(therapistDirectoryBlock, /onboardDate:\s*normalizeText\(source\.onboardDate \|\| source\.startDate/);
  assert.match(therapistDirectoryBlock, /resignDate:/);
  assert.match(therapistDirectoryBlock, /isActive:/);
  assert.doesNotMatch(therapistDirectoryBlock, /password|credentialStorageMode|secret|token/i);
});

test("LoginView receives sanitized selectors and never receives or compares stored passwords", () => {
  assert.match(app, /loginDirectory=\{loginDirectory\}/);
  assert.match(login, /const directory = loginDirectory/);
  assert.match(login, /Array\.isArray\(directory\.therapists\)/);
  assert.match(login, /const finishBackendLogin = async/);
  assert.match(login, /result\?\.credentialRejected/);
  assert.doesNotMatch(login, /managerAuth|masterAuth|trainerAuth|directorAuth/);
  assert.doesNotMatch(login, /\.password\s*===|===\s*[^;\n]*\.password|password === correctPass|correctPass/);
  assert.doesNotMatch(app, /masterAuth=\{masterAuth\}/);
});

test("first-login password update is backend-authoritative and direct LoginView credential writers are retired", () => {
  assert.match(app, /CHANGE_APPLICATION_PASSWORD_ENDPOINT/);
  assert.match(app, /const changeApplicationPassword = useCallback/);
  assert.match(login, /onChangeApplicationPassword/);
  assert.match(login, /await onChangeApplicationPassword\(\{ roleId, accountId, currentPassword, newPassword: nextPass \}\)/);
  assert.match(login, /master_override_not_allowed/);
  assert.doesNotMatch(login, /onUpdatePassword|onUpdateManagerPassword|onUpdateTherapistPassword|handleUpdateTrainerAuth|handleUpdateDirectorAuth/);
});

test("backend application identity is authoritative for director level and master-login state", () => {
  const loginBlock = sliceBetween(app, "const handleLogin", "const resumePendingDeviceLogin");
  assert.match(loginBlock, /const verifiedIdentity = deviceSecurity\?\.applicationIdentity \|\| \{\}/);
  assert.match(loginBlock, /directorLevel: String\(verifiedIdentity\?\.directorLevel/);
  assert.match(loginBlock, /isMasterLogin: verifiedIdentity\?\.isMasterCredential === true/);
  assert.match(loginBlock, /await activateApplicationIdentitySession/);
  assert.ok(loginBlock.indexOf("await activateApplicationIdentitySession") < loginBlock.indexOf("setUserRole(roleId)"));
});

test("legacy settings credential material remains lazy while therapist manager reuses the sanitized login directory", () => {
  const adminBlock = sliceBetween(app, "P0-B1C2C2 transitional admin hydration", "const targetYearStr = String(selectedYear)");
  assert.match(adminBlock, /activeView === "settings"/);
  assert.match(adminBlock, /activeView === "therapist-manager"/);
  assert.match(adminBlock, /getDoc\(getDocPath\("store_account_data"\)\)/);
  assert.match(adminBlock, /getDoc\(getDocPath\("manager_auth"\)\)/);
  assert.match(adminBlock, /getDoc\(getDocPath\("trainer_auth"\)\)/);
  assert.doesNotMatch(adminBlock, /getDocs\(getCollectionPath\("therapists"\)\)/);
  assert.doesNotMatch(adminBlock, /master_auth|director_auth/);
  assert.match(adminBlock, /ownsTherapistMasterHydration/);
  assert.match(adminBlock, /管師帳號直接使用登入時已取得的 sanitized directory/);
  assert.match(adminBlock, /restoreSanitizedState\(\)/);
  assert.match(adminBlock, /status:\s*"ready"[\s\S]{0,120}view:\s*"therapist-manager"/);
  assert.doesNotMatch(adminBlock, /onSnapshot\s*\(/);
  assert.doesNotMatch(adminBlock, /setInterval\s*\(/);

  assert.doesNotMatch(app, /callTherapistMasterAuthority\(\{ action: "list" \}\)/);
  assert.match(app, /const refreshTherapistMasterRecord = useCallback/);
  assert.match(app, /trackReadSource\([\s\S]{0,120}"admin_therapist_master_record_backend"/);
});

test("directory cutover does not advance Rules lockdown or app version", () => {
  assert.match(rules, /function signedIn\(\)\s*\{\s*return request\.auth != null;/);
  assert.match(app, /CURRENT_APP_VERSION\s*=\s*"3\.6\.0"/);
});

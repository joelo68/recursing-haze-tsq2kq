import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), "utf8");

const rules = read("firestore.rules");
const app = read("src/App.jsx");
const settings = read("src/components/SettingsView.jsx");
const input = read("src/components/InputView.jsx");
const targetView = read("src/components/TherapistTargetView.jsx");
const scheduleView = read("src/components/TherapistScheduleView.jsx");
const managerView = read("src/components/TherapistManagerView.jsx");
const masterAuthority = read("functions/therapistMasterAuthority.js");
const credentialAuthority = read("functions/therapistCredentialAuthority.js");

const directTherapistWritePattern =
  /(setDoc|addDoc|updateDoc|deleteDoc)\s*\([^;\n]*getCollectionPath\(["']therapists["']\)|getCollectionPath\(["']therapists["']\)[^;\n]*(setDoc|addDoc|updateDoc|deleteDoc)/;

test("B1C2D keeps therapist master readable but blocks direct browser writes on both physical roots", () => {
  assert.match(
    rules,
    /match \/brands\/\{brandId\}\/therapists\/\{document=\*\*\}\s*\{\s*allow read: if signedIn\(\);\s*allow write: if false;\s*\}/s
  );
  assert.match(
    rules,
    /match \/artifacts\/\{appId\}\/public\/data\/therapists\/\{document=\*\*\}\s*\{\s*allow read: if signedIn\(\);\s*allow write: if false;\s*\}/s
  );
});

test("B1C2D closes broad fallback OR grants for therapists on both brand path families", () => {
  const exclusions = rules.match(/collectionName != 'therapists'/g) || [];
  assert.equal(exclusions.length, 2);

  assert.match(
    rules,
    /match \/brands\/\{brandId\}\/\{collectionName\}\/\{document=\*\*\}[\s\S]*?collectionName != 'therapist_credentials'[\s\S]*?collectionName != 'therapists'[\s\S]*?collectionName != 'store_lifecycle'/
  );
  assert.match(
    rules,
    /match \/artifacts\/\{appId\}\/public\/data\/\{collectionName\}\/\{document=\*\*\}[\s\S]*?collectionName != 'therapist_credentials'[\s\S]*?collectionName != 'therapists'[\s\S]*?collectionName != 'global_blocked_devices'/
  );
});

test("therapist targets and schedules remain separate browser-managed collections", () => {
  assert.doesNotMatch(rules, /collectionName != 'therapist_targets'/);
  assert.doesNotMatch(rules, /collectionName != 'therapist_schedules'/);
  assert.match(targetView, /getCollectionPath\("therapist_targets"\)/);
  assert.match(scheduleView, /getCollectionPath\("therapist_schedules"\)/);
});

test("frontend therapist master mutation bypasses remain retired before Rules lockdown", () => {
  assert.doesNotMatch(app, directTherapistWritePattern);
  assert.doesNotMatch(settings, /getCollectionPath\(["']therapists["']\)/);
  assert.doesNotMatch(settings, /handleAddTherapist|handleUpdateTherapist|handleDeleteTherapist/);
  assert.doesNotMatch(managerView, /firebase\/firestore|setDoc\(|addDoc\(|updateDoc\(|deleteDoc\(/);
  assert.doesNotMatch(input, directTherapistWritePattern);
  assert.doesNotMatch(targetView, directTherapistWritePattern);
  assert.doesNotMatch(scheduleView, directTherapistWritePattern);
});

test("Backend remains the sole therapist master mutation authority and credential migration stays out of scope", () => {
  for (const action of ["create", "update", "archive", "restore", "delete", "reset_password"]) {
    assert.match(masterAuthority, new RegExp(`"${action}"`));
  }
  assert.match(masterAuthority, /manageTherapistMasterInTransaction/);
  assert.match(masterAuthority, /verifySuperAdminActor/);
  assert.match(masterAuthority, /expectedMasterSignature/);
  assert.doesNotMatch(masterAuthority, /migrateTherapistCredentialInTransaction/);
  assert.match(credentialAuthority, /THERAPIST_CREDENTIAL_STORAGE_MODE_EMBEDDED/);
  assert.match(credentialAuthority, /THERAPIST_CREDENTIAL_STORAGE_MODE_SEPARATED/);
});

test("B1C2D is Rules-only and does not change app version or read topology", () => {
  assert.match(app, /CURRENT_APP_VERSION\s*=\s*"3\.6\.0"/);
  assert.doesNotMatch(managerView, /onSnapshot\s*\(|setInterval\s*\(|setTimeout\s*\(/);
  assert.match(managerView, /action:\s*"get"/);
  assert.match(managerView, /action:\s*"reset_password"/);
});

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), "utf8");
const require = createRequire(import.meta.url);

const {
  TRAINER_THERAPIST_MASTER_ACTIONS,
  assertTrainerApplicationIdentity,
  assertTrainerTherapistManagerPermission,
} = require("../functions/therapistMasterAuthority");

const app = read("src/App.jsx");
const constants = read("src/constants/index.js");
const managerView = read("src/components/TherapistManagerView.jsx");
const backend = read("functions/therapistMasterAuthority.js");
const functionsIndex = read("functions/index.js");
const rules = read("firestore.rules");

const snapshot = (exists, data = {}) => ({
  exists,
  data: () => data,
});

test("trainer therapist-account business contract allows operational actions but forbids disclosure and permanent delete", () => {
  for (const action of ["get", "create", "update", "archive", "restore", "reset_password"]) {
    assert.equal(TRAINER_THERAPIST_MASTER_ACTIONS.has(action), true, `${action} must be allowed`);
  }
  assert.equal(TRAINER_THERAPIST_MASTER_ACTIONS.has("delete"), false);
  assert.equal(TRAINER_THERAPIST_MASTER_ACTIONS.has("list"), false);

  assert.match(constants, /roles:\s*\["director",\s*"trainer",\s*"manager"\][\s\S]*requiresTherapistModule:\s*true/);
  assert.match(constants, /trainer:\s*\[[^\]]*"therapist-manager"[^\]]*\]/);
});

test("trainer authority requires exact server-issued Application Identity and same account", () => {
  const auth = {
    decoded: {
      drcyjIdentity: true,
      identityVersion: "application-identity-v1",
      brandId: "anniu",
      roleId: "trainer",
      accountId: "trainer_1",
    },
  };
  const actor = { roleId: "trainer", accountId: "trainer_1" };

  assert.equal(
    assertTrainerApplicationIdentity(auth, "anniu", actor, { actorAccountId: "trainer_1" }),
    true
  );

  assert.throws(
    () => assertTrainerApplicationIdentity(
      { decoded: { firebase: { sign_in_provider: "anonymous" } } },
      "anniu",
      actor,
      { actorAccountId: "trainer_1" }
    ),
    /trainer_application_identity_mismatch/
  );

  assert.throws(
    () => assertTrainerApplicationIdentity(
      auth,
      "yibo",
      actor,
      { actorAccountId: "trainer_1" }
    ),
    /trainer_application_identity_mismatch/
  );

  assert.throws(
    () => assertTrainerApplicationIdentity(
      auth,
      "anniu",
      actor,
      { actorAccountId: "another_trainer" }
    ),
    /trainer_application_identity_mismatch/
  );
});

test("trainer module permission defaults to role contract when doc is absent but fails closed when an explicit doc revokes it", () => {
  assert.equal(assertTrainerTherapistManagerPermission(snapshot(false)), true);
  assert.equal(
    assertTrainerTherapistManagerPermission(
      snapshot(true, { trainer: ["dashboard", "therapist-manager"] })
    ),
    true
  );
  assert.throws(
    () => assertTrainerTherapistManagerPermission(
      snapshot(true, { trainer: ["dashboard", "ranking"] })
    ),
    /therapist_master_permission_required/
  );
});

test("backend re-verifies trainer trusted device and current credential and transactionally rechecks permission before mutations", () => {
  assert.match(functionsIndex, /verifyTrustedApplicationActor/);
  assert.match(
    functionsIndex,
    /createTherapistMasterAuthorityFunctions\(\{[\s\S]*verifyTrustedApplicationActor[\s\S]*assertAdminApplicationClaims/
  );
  assert.match(backend, /allowedRoles:\s*\["trainer"\]/);
  assert.match(backend, /trainer_reverification_required/);
  assert.match(backend, /trainer_therapist_master_action_forbidden/);
  assert.match(
    backend,
    /actorRole === "trainer"[\s\S]*getBrandSettingDoc\(db,\s*brandId,\s*"permissions"\)[\s\S]*transaction\.get\(trainerPermissionRef\)/
  );
});

test("frontend gives trainer a ready sanitized directory and sends the real role instead of impersonating director", () => {
  assert.match(
    app,
    /activeView === "therapist-manager"[\s\S]*userRole === "director" \|\| userRole === "trainer"[\s\S]*canDirectorAccessView\("therapist-manager"\)/
  );

  const start = app.indexOf("const canManageTherapistAccounts");
  const end = app.indexOf("const normalizeTherapistMasterRow", start);
  assert.ok(start >= 0 && end > start);
  const block = app.slice(start, end);

  assert.match(block, /userRole === "trainer"/);
  assert.match(block, /roleId:\s*userRole/);
  assert.doesNotMatch(block, /roleId:\s*"director"/);
});

test("trainer UI never exposes password reveal or permanent delete while reset remains available", () => {
  assert.match(app, /canRevealTherapistPassword:\s*isDeviceSecuritySuperAdmin/);
  assert.match(app, /canDeleteTherapistAccount:\s*isDeviceSecuritySuperAdmin/);

  assert.match(managerView, /canRevealTherapistPassword && \(/);
  assert.match(managerView, /if \(!canRevealTherapistPassword\)/);
  assert.match(managerView, /canDeleteTherapistAccount && \(/);
  assert.match(managerView, /if \(!canDeleteTherapistAccount\)/);
  assert.match(managerView, /action:\s*"reset_password"/);
  assert.match(managerView, /action:\s*"reveal_password"/);
});

test("security boundary remains Backend-only with no new browser Firestore writer, listener or polling", () => {
  assert.doesNotMatch(managerView, /firebase\/firestore|setDoc\(|addDoc\(|updateDoc\(|deleteDoc\(/);
  assert.doesNotMatch(managerView, /onSnapshot\s*\(|setInterval\s*\(|setTimeout\s*\(/);

  assert.match(
    rules,
    /match \/brands\/\{brandId\}\/therapists\/\{document=\*\*\}\s*\{\s*allow read: if sameBrandIdentity\(brandId\);\s*allow write: if false;/s
  );
  assert.match(
    rules,
    /match \/artifacts\/\{appId\}\/public\/data\/therapists\/\{document=\*\*\}\s*\{\s*allow read: if cyjLegacyIdentity\(appId\);\s*allow write: if false;/s
  );
  assert.match(app, /CURRENT_APP_VERSION\s*=\s*"3\.6\.0"/);
});

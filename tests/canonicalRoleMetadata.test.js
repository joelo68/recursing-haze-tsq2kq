import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const constants = read("src/constants/index.js");
const app = read("src/App.jsx");
const settings = read("src/components/SettingsView.jsx");
const monitor = read("src/components/SystemMonitor.jsx");
const devicePanel = read("src/components/DeviceApprovalPanel.jsx");
const login = read("src/components/LoginView.jsx");

test("Canonical Role Metadata v1 owns the five Application Role presentation labels", () => {
  assert.match(constants, /export const APPLICATION_ROLE_METADATA = Object\.freeze\(\[/);
  for (const [id, label] of [
    ["director", "高階主管"],
    ["trainer", "教專"],
    ["manager", "區長"],
    ["store", "店經理"],
    ["therapist", "管理師"],
  ]) {
    assert.match(constants, new RegExp(`id: "${id}", label: "${label}"`));
  }
  assert.match(constants, /export const APPLICATION_ROLE_IDS = Object\.freeze\(/);
  assert.match(constants, /export const getRoleLabel = /);
  assert.match(constants, /export const getRoleBadgeLabel = /);
  assert.match(constants, /export const ROLES = Object\.freeze\(/);
});

test("role presentation metadata carries no client-side credential-like pass field", () => {
  const roleStart = constants.indexOf("export const APPLICATION_ROLE_METADATA");
  const roleEnd = constants.indexOf("export const ALL_MENU_ITEMS", roleStart);
  assert.ok(roleStart >= 0 && roleEnd > roleStart);
  const roleBlock = constants.slice(roleStart, roleEnd);

  assert.doesNotMatch(roleBlock, /\bpass\s*:/);
  assert.doesNotMatch(roleBlock, /\bpassword\s*:/);
  assert.match(login, /finishBackendLogin/);
  assert.match(login, /await onLogin\(roleId, userInfo, \{ accountId, password:/);
});

test("master stays a presentation-only Security/Audit actor and is excluded from login role metadata", () => {
  const applicationStart = constants.indexOf("export const APPLICATION_ROLE_METADATA");
  const specialStart = constants.indexOf("export const SECURITY_ACTOR_ROLE_METADATA", applicationStart);
  assert.ok(applicationStart >= 0 && specialStart > applicationStart);
  const applicationBlock = constants.slice(applicationStart, specialStart);

  assert.doesNotMatch(applicationBlock, /id: "master"/);
  assert.match(constants, /master: Object\.freeze\(\{ id: "master", label: "最高管理者", badgeLabel: "最高管理者" \}\)/);
});

test("presentation consumers no longer maintain independent role-label maps", () => {
  assert.doesNotMatch(app, /const DEVICE_APPROVAL_ROLE_LABELS/);
  assert.match(app, /getRoleLabel\(superAdminDeviceNotice\.role/);

  assert.doesNotMatch(devicePanel, /const ROLE_LABELS/);
  assert.match(devicePanel, /getRoleLabel\(request\.role, request\.role \|\| "帳號"\)/);

  for (const roleId of ["trainer", "manager", "store", "therapist"]) {
    assert.match(settings, new RegExp(`label: getRoleLabel\\("${roleId}"\\)`));
  }
  assert.match(settings, /APPLICATION_ROLE_METADATA\.map\(\(role\) =>/);
  assert.match(settings, /APPLICATION_ROLE_METADATA\.filter\(\(role\) => role\.id !== "director"\)/);

  assert.match(monitor, /director: getRoleLabel\("director"\)/);
  assert.match(monitor, /master: getRoleLabel\("master"\)/);
  assert.match(monitor, /getRoleBadgeLabel\(role, "未知"\)/);

  assert.match(login, /\{r\.label\}/);
  assert.doesNotMatch(login, /r\.id === 'director' \? '高階主管'/);
});

test("Backend and Firestore Rules remain the independent authorization authorities", () => {
  const identity = read("functions/applicationIdentity.js");
  const modulePermissions = read("functions/modulePermissions.js");
  const accountAuthority = read("functions/accountAuthority.js");
  const adminSettings = read("functions/administrativeSettingsAuthority.js");
  const deviceApproval = read("functions/deviceApproval.js");
  const rules = read("firestore.rules");

  for (const role of ["director", "trainer", "manager", "store", "therapist"]) {
    assert.match(identity, new RegExp(`"${role}"`));
  }
  assert.match(identity, /const APPLICATION_IDENTITY_ROLES = Object\.freeze\(\[/);
  assert.match(modulePermissions, /const MODULE_PERMISSION_ROLES = Object\.freeze\(\['director', 'trainer', 'manager', 'store', 'therapist'\]\)/);
  assert.match(accountAuthority, /const MANAGED_ACCOUNT_ROLES = new Set\(\["director", "trainer", "manager", "store", "therapist"\]\)/);
  assert.match(adminSettings, /const SUPPORTED_ROLES = new Set\(\["director", "trainer", "manager", "store", "therapist"\]\)/);
  assert.match(deviceApproval, /deviceApprovalRoles: \['director', 'trainer', 'manager', 'store', 'therapist'\]/);
  assert.match(rules, /request\.auth\.token\.roleId in \['director', 'trainer', 'manager', 'store', 'therapist'\]/);
});

test("Security configuration semantics stay unchanged while its UI labels become canonical", () => {
  assert.match(app, /exemptRoles: \["director", "master"\]/);
  assert.match(app, /deviceApprovalRoles: \["director", "trainer", "manager", "store", "therapist"\]/);
  assert.match(settings, /exemptRoles: \["director", "master"\]/);
  assert.match(settings, /deviceApprovalRoles: \["director", "trainer", "manager", "store", "therapist"\]/);
});

test("role presentation metadata itself has no data access, polling, mutation, or network behavior", () => {
  const start = constants.indexOf("export const APPLICATION_ROLE_METADATA");
  const end = constants.indexOf("export const ALL_MENU_ITEMS", start);
  assert.ok(start >= 0 && end > start);
  const roleBlock = constants.slice(start, end);

  assert.doesNotMatch(roleBlock, /firebase|firestore|fetch\(|onSnapshot|getDoc|getDocs|setDoc|addDoc|updateDoc|deleteDoc|query\(|collection\(|setInterval|setTimeout/);
});

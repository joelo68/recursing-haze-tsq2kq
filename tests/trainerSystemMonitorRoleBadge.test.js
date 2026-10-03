import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const monitor = fs.readFileSync("src/components/SystemMonitor.jsx", "utf8");
const app = fs.readFileSync("src/App.jsx", "utf8");
const constants = fs.readFileSync("src/constants/index.js", "utf8");

test("trainer operation logs render the canonical 教專 badge through shared role presentation metadata", () => {
  assert.match(constants, /id: "trainer", label: "教專", badgeLabel: "教專"/);
  assert.match(monitor, /import \{ getRoleBadgeLabel, getRoleLabel \} from "\.\.\/constants\/index"/);

  const badgeStart = monitor.indexOf("const getRoleBadge = (role) =>");
  const badgeEnd = monitor.indexOf("const getDeviceIcon", badgeStart);
  assert.ok(badgeStart >= 0 && badgeEnd > badgeStart, "getRoleBadge block missing");
  const badgeBlock = monitor.slice(badgeStart, badgeEnd);

  assert.match(badgeBlock, /trainer: "bg-sky-50 text-sky-600"/);
  assert.match(badgeBlock, /getRoleBadgeLabel\(role, "未知"\)/);
});

test("master audit/security actor has canonical presentation metadata without becoming an Application Identity role", () => {
  const applicationStart = constants.indexOf("export const APPLICATION_ROLE_METADATA");
  const applicationEnd = constants.indexOf("export const SECURITY_ACTOR_ROLE_METADATA", applicationStart);
  assert.ok(applicationStart >= 0 && applicationEnd > applicationStart);
  const applicationBlock = constants.slice(applicationStart, applicationEnd);

  assert.doesNotMatch(applicationBlock, /id: "master"/);
  assert.match(constants, /master: Object\.freeze\(\{ id: "master", label: "最高管理者", badgeLabel: "最高管理者" \}\)/);
  assert.match(monitor, /master: "bg-stone-100 text-stone-700"/);
});

test("trainer login/logout writers preserve the canonical trainer role while display fallback uses shared metadata", () => {
  assert.match(app, /logActivity\(roleId, userName, "登入系統"/);
  assert.match(app, /logActivity\(userRole, userName, "登出系統"/);
  assert.match(app, /role,\s*\n\s*user,\s*\n\s*action,/);
  assert.match(app, /\["director", "trainer"\]\.includes\(roleId\) \? getRoleLabel\(roleId, "使用者"\)/);
});

test("trainer role filter remains aligned with the same canonical role and legacy log aliases", () => {
  assert.match(monitor, /trainer: getRoleLabel\("trainer"\)/);
  assert.match(monitor, /logRoleFilter === "trainer"/);
  assert.match(monitor, /roleText\.includes\("trainer"\) \|\| roleText\.includes\("教專"\)/);
});

test("role-badge metadata consolidation adds no Firestore reads, listeners, polling or writes", () => {
  const badgeStart = monitor.indexOf("const getRoleBadge = (role) =>");
  const badgeEnd = monitor.indexOf("const getDeviceIcon", badgeStart);
  const badgeBlock = monitor.slice(badgeStart, badgeEnd);

  assert.doesNotMatch(badgeBlock, /onSnapshot|getDoc|getDocs|addDoc|setDoc|updateDoc|query\(|collection\(|setInterval|setTimeout/);
});

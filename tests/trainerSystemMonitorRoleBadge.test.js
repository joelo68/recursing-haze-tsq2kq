import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const monitor = fs.readFileSync("src/components/SystemMonitor.jsx", "utf8");
const app = fs.readFileSync("src/App.jsx", "utf8");

test("trainer operation logs render the canonical 教專 badge instead of falling through to 未知", () => {
  const badgeStart = monitor.indexOf("const getRoleBadge = (role) =>");
  const badgeEnd = monitor.indexOf("const getDeviceIcon", badgeStart);
  assert.ok(badgeStart >= 0 && badgeEnd > badgeStart, "getRoleBadge block missing");
  const badgeBlock = monitor.slice(badgeStart, badgeEnd);

  assert.match(badgeBlock, /case "trainer":[\s\S]*?>教專<\/span>/);
  assert.match(badgeBlock, /default:[\s\S]*?>未知<\/span>/);
  assert.ok(
    badgeBlock.indexOf('case "trainer":') < badgeBlock.indexOf("default:"),
    "trainer must resolve before the unknown fallback"
  );
});

test("trainer login/logout writers already persist the canonical trainer role, so no historical log migration is required", () => {
  assert.match(app, /logActivity\(roleId, userName, "登入系統"/);
  assert.match(app, /logActivity\(userRole, userName, "登出系統"/);
  assert.match(app, /role,\s*\n\s*user,\s*\n\s*action,/);
  assert.match(app, /roleId === "trainer" \? "教專"/);
});

test("trainer role filter remains aligned with the same canonical role", () => {
  assert.match(monitor, /trainer: "教專"/);
  assert.match(monitor, /logRoleFilter === "trainer"/);
  assert.match(monitor, /roleText\.includes\("trainer"\) \|\| roleText\.includes\("教專"\)/);
});

test("the role-badge fix does not add Firestore reads, listeners, polling or writes", () => {
  const badgeStart = monitor.indexOf("const getRoleBadge = (role) =>");
  const badgeEnd = monitor.indexOf("const getDeviceIcon", badgeStart);
  const badgeBlock = monitor.slice(badgeStart, badgeEnd);

  assert.doesNotMatch(badgeBlock, /onSnapshot|getDoc|getDocs|addDoc|setDoc|updateDoc|query\(|collection\(|setInterval|setTimeout/);
});

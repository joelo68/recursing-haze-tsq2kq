import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const directorPermissionModuleUrl = pathToFileURL(
  path.join(root, "src/utils/directorPermissions.js")
).href;

test("高階主管頁面權限改為資料驅動，並保留既有角色預設", async () => {
  const {
    DEFAULT_DIRECTOR_LEVEL_PERMISSIONS,
    normalizeDirectorLevelPermissionMap,
    resolveDirectorLevelPermissionProfile,
  } = await import(directorPermissionModuleUrl);

  assert.deepEqual(DEFAULT_DIRECTOR_LEVEL_PERMISSIONS.operation_admin, [
    "dashboard",
    "daily",
    "regional",
    "ranking",
    "store-analysis",
    "audit",
    "annual",
    "smart-forecast",
    "logs",
    "notification",
  ]);

  const fallback = normalizeDirectorLevelPermissionMap({});
  assert.deepEqual(fallback.operation_admin, DEFAULT_DIRECTOR_LEVEL_PERMISSIONS.operation_admin);
  assert.deepEqual(fallback.finance_admin, DEFAULT_DIRECTOR_LEVEL_PERMISSIONS.finance_admin);
  assert.deepEqual(fallback.viewer, DEFAULT_DIRECTOR_LEVEL_PERMISSIONS.viewer);

  const configured = normalizeDirectorLevelPermissionMap({
    operation_admin: ["ranking", "settings"],
    finance_admin: [],
    viewer: ["annual"],
  });

  assert.ok(configured.operation_admin.includes("dashboard"), "dashboard must remain available");
  assert.ok(configured.operation_admin.includes("ranking"));
  assert.equal(configured.operation_admin.includes("settings"), false, "settings is super-admin only");
  assert.deepEqual(configured.finance_admin, ["dashboard"]);
  assert.deepEqual(configured.viewer, ["dashboard", "annual"]);

  const superAdmin = resolveDirectorLevelPermissionProfile({ directorLevels: configured }, "super_admin");
  assert.equal(superAdmin.allowedViews, null);

  const finance = resolveDirectorLevelPermissionProfile({ directorLevels: configured }, "finance_admin");
  assert.equal(finance.allowedViews.has("dashboard"), true);
  assert.equal(finance.allowedViews.has("annual"), false);
});

test("App 不再以 DIRECTOR_VIEW_PERMISSIONS 寫死三個高階主管層級，並在 renderer 與 navigation 共用動態 guard", () => {
  const app = read("src/App.jsx");
  const navigation = read("src/components/Navigation.jsx");

  assert.doesNotMatch(app, /const DIRECTOR_VIEW_PERMISSIONS\s*=/);
  assert.match(app, /resolveDirectorLevelPermissionProfile\(permissions,\s*directorLevel\)/);
  assert.match(app, /directorPermissionProfile\.allowedViews\.has\(viewId\)/);

  for (const viewId of ["dashboard", "daily", "regional", "ranking", "store-analysis", "audit", "annual"]) {
    const escaped = viewId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(
      app,
      new RegExp(`activeView === "${escaped}" && canDirectorAccessView\\("${escaped}"\\)`)
    );
  }

  assert.match(navigation, /canAccessView\(item\.id\)/);
});

test("高階主管帳號管理提供品牌獨立頁面權限矩陣，最高管理與安全首頁限制不可被取消", () => {
  const settings = read("src/components/SettingsView.jsx");

  assert.match(settings, /高階主管頁面權限/);
  assert.match(settings, /目前品牌：\{brandLabel\}/);
  assert.match(settings, /DIRECTOR_PERMISSION_LEVEL_OPTIONS\.map/);
  assert.match(settings, /最高管理者固定保留全部頁面/);
  assert.match(settings, /「營運總覽」固定保留作為登入首頁/);
  assert.match(settings, /「系統設定」固定只允許最高管理者/);
  assert.match(settings, /handleSaveDirectorLevelPermissions/);
  assert.match(settings, /updateModulePermissions\(nextPermissions\)/);
  assert.match(settings, /本機試跑：高階主管頁面權限已模擬儲存，不會寫入正式資料/);
});

test("Module Permissions v2 沿用單一 brand-scoped permissions 文件與 OCC，且舊版 client 不會清掉 directorLevels", () => {
  const backend = read("functions/modulePermissions.js");
  const app = read("src/App.jsx");
  const rules = read("firestore.rules");

  assert.match(backend, /MODULE_PERMISSIONS_SCHEMA_VERSION = 'module-permissions-v2'/);
  assert.match(backend, /DIRECTOR_PERMISSION_LEVELS = Object\.freeze\(\['operation_admin', 'finance_admin', 'viewer'\]\)/);
  assert.match(backend, /requestHasDirectorLevels/);
  assert.match(
    backend,
    /requestHasDirectorLevels[\s\S]*\? normalizeDirectorLevelPermissions\(rawRequestedPermissions\.directorLevels \|\| \{\}\)[\s\S]*: normalizeDirectorLevelPermissions\(current\.directorLevels \|\| \{\}\)/
  );
  assert.match(backend, /db\.runTransaction/);
  assert.match(backend, /MODULE_PERMISSIONS_CONFLICT/);
  assert.match(backend, /getBrandSettingDoc\(db, brandId, 'permissions'\)/);

  assert.match(app, /\{ key: "permissions", promise: getDoc\(getDocPath\("permissions"\)\) \}/);
  assert.match(app, /brandId:\s*currentBrandId/);

  assert.match(rules, /match \/brands\/\{brandId\}\/settings\/permissions[\s\S]*allow read: if sameBrandIdentity\(brandId\)[\s\S]*allow write: if false/);
  assert.match(rules, /settingId != 'permissions'/);
});

test("新增矩陣不新增 listener/query/polling，且本機試跑不會寫 Production", () => {
  const settings = read("src/components/SettingsView.jsx");
  const app = read("src/App.jsx");

  const start = settings.indexOf("高階主管頁面權限");
  const end = settings.indexOf("新增高階主管姓名", start);
  assert.ok(start >= 0 && end > start);
  const matrixUi = settings.slice(start, end);

  for (const forbidden of [
    "getDoc(",
    "getDocs(",
    "setDoc(",
    "updateDoc(",
    "addDoc(",
    "onSnapshot(",
    "setInterval(",
  ]) {
    assert.equal(matrixUi.includes(forbidden), false, `matrix UI must not add direct operation: ${forbidden}`);
  }

  assert.match(settings, /\["localhost", "127\.0\.0\.1"\]\.includes\(window\.location\.hostname\)/);
  assert.match(settings, /isLocalDirectorPermissionTrial/);
  assert.match(app, /getDoc\(getDocPath\("permissions"\)\)/);
});

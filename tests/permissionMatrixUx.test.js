import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("權限矩陣固定職務標題與功能模組欄，長清單捲動時仍可辨識欄位", () => {
  const source = read("src/components/SettingsView.jsx");

  assert.match(source, /const PERMISSION_ROLE_COLUMNS = \[/);
  for (const role of ["教專", "區長", "店經理", "管理師"]) {
    assert.match(source, new RegExp(`label: "${role}"`));
  }

  assert.match(source, /max-h-\[68vh\] overflow-auto/);
  assert.match(source, /sticky top-0 left-0 z-40/);
  assert.match(source, /sticky top-0 z-30/);
  assert.match(source, /sticky left-0 z-20/);
});

test("權限矩陣持續顯示目前編輯職務並高亮對應欄", () => {
  const source = read("src/components/SettingsView.jsx");

  assert.match(source, /const \[activePermissionRole, setActivePermissionRole\] = useState\(""\)/);
  assert.match(source, /目前編輯職務：/);
  assert.match(source, /activePermissionRole === role\.id/);
  assert.match(source, /onClick=\{\(\) => setActivePermissionRole\(role\.id\)\}/);
  assert.match(source, /onFocus=\{\(\) => setActivePermissionRole\(role\.id\)\}/);
  assert.match(source, /aria-label=\{`\$\{role\.label\}｜\$\{item\.label\}`\}/);
});

test("權限矩陣只改本機草稿，正式儲存仍走既有安全服務", () => {
  const source = read("src/components/SettingsView.jsx");

  assert.match(source, /const result = await updateModulePermissions\(localPermissions\)/);
  assert.match(source, /setPermissionMatrixTouched\(true\)/);
  assert.match(source, /setPermissionMatrixTouched\(false\)/);
  assert.match(source, /有尚未儲存的權限變更/);

  const start = source.indexOf('{activeTab === "permissions"');
  const end = source.indexOf('{activeTab === "feature-flags"', start);
  assert.ok(start >= 0 && end > start);
  const permissionUi = source.slice(start, end);

  for (const forbidden of [
    "getDoc(",
    "getDocs(",
    "setDoc(",
    "addDoc(",
    "updateDoc(",
    "writeBatch(",
    "onSnapshot(",
    "setInterval(",
  ]) {
    assert.equal(permissionUi.includes(forbidden), false, `permission UI must not add direct data operation: ${forbidden}`);
  }
});

test("權限矩陣儲存列固定可見並提醒儲存前再次確認職務", () => {
  const source = read("src/components/SettingsView.jsx");

  assert.match(source, /sticky bottom-3 z-30/);
  assert.match(source, /儲存前請確認「目前編輯職務」與高亮欄位是否正確。/);
  assert.match(source, />\s*儲存模組權限\s*</);
});

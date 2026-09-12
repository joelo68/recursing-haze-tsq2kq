import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const require = createRequire(import.meta.url);

const {
  applyDirectorAdminAction,
  manageAccountInTransaction,
} = require("../functions/accountAuthority");

const app = read("src/App.jsx");
const settings = read("src/components/SettingsView.jsx");
const backend = read("functions/accountAuthority.js");
const rules = read("firestore.rules");

test("Settings no longer triggers a fetchGlobalData loop on mount", () => {
  assert.doesNotMatch(
    settings,
    /useEffect\(\(\)\s*=>\s*\{\s*if\s*\(fetchGlobalData\)\s*fetchGlobalData\(\);\s*\},\s*\[fetchGlobalData\]\s*\)/s,
  );
  assert.match(app, /activeView === "settings"/);
  assert.match(app, /adminCredentialSourceState\.status === "ready"/);
});

test("director account management lives in Settings and uses backend authority instead of raw director_auth", () => {
  assert.match(settings, /id:\s*"director-account",\s*label:\s*"高階主管帳號"/);
  assert.match(settings, /manageApplicationAccountAction/);
  assert.match(app, /const MANAGE_APPLICATION_ACCOUNT_ENDPOINT\s*=\s*"https:\/\/us-central1-cyjsituation-analysis\.cloudfunctions\.net\/manageApplicationAccount"/);
  assert.match(app, /const manageApplicationAccountAction = useCallback/);
  assert.match(app, /actor:\s*\{\s*\.\.\.buildDeviceSecurityActor\(\),\s*roleId:\s*"director"\s*\}/);
  assert.doesNotMatch(settings, /getDocPath\("director_auth"\)|setDoc\(getDocPath\("director_auth"\)/);
  const directorBlock = settings.slice(
    settings.indexOf('activeTab === "director-account"'),
    settings.indexOf('activeTab === "trainer-account"'),
  );
  assert.ok(directorBlock.length > 0);
  assert.doesNotMatch(directorBlock, /account\.password|directorAuth|value=\{[^}]*account[^}]*password/i);
  assert.match(directorBlock, /value=\{directorManagementKeyInput\}/);
  assert.match(directorBlock, /value=\{currentMasterManagementKey\}/);
});

test("director admin supports delete but preserves the last active super admin", () => {
  const nowText = "2026-09-12T12:00:00.000Z";
  const raw = {
    accounts: {
      d1: { id: "d1", name: "A", password: "a", level: "super_admin", isActive: true },
      d2: { id: "d2", name: "B", password: "b", level: "super_admin", isActive: true },
      d3: { id: "d3", name: "C", password: "c", level: "operation_admin", isActive: true },
    },
    directorOrder: ["d1", "d2", "d3"],
  };

  const deleted = applyDirectorAdminAction({
    raw,
    action: "delete",
    targetAccountId: "d2",
    payload: {},
    brandId: "cyj",
    nowText,
  });
  assert.equal(deleted.deleted, true);
  assert.equal(deleted.next.accounts.d2, undefined);
  assert.deepEqual(deleted.next.directorOrder, ["d1", "d3"]);

  assert.throws(() => applyDirectorAdminAction({
    raw: {
      accounts: {
        d1: { id: "d1", name: "A", password: "a", level: "super_admin", isActive: true },
        d3: { id: "d3", name: "C", password: "c", level: "operation_admin", isActive: true },
      },
      directorOrder: ["d1", "d3"],
    },
    action: "delete",
    targetAccountId: "d1",
    payload: {},
    brandId: "cyj",
    nowText,
  }), (error) => error?.code === "last_super_admin_required");
});

test("current signed-in director cannot rename demote disable or delete itself", async () => {
  const accountRef = {
    data: {
      accounts: {
        d1: { id: "d1", name: "A", password: "a", level: "super_admin", isActive: true },
        d2: { id: "d2", name: "B", password: "b", level: "super_admin", isActive: true },
      },
      directorOrder: ["d1", "d2"],
    },
  };
  const masterRef = { data: { password: "master-key", revision: 1 } };
  let writes = 0;
  const transaction = {
    async get(ref) {
      return { exists: true, data: () => structuredClone(ref.data) };
    },
    set() { writes += 1; },
  };
  const getBrandSettingDoc = (_db, _brandId, name) => name === "master_auth" ? masterRef : accountRef;
  const getBrandCollection = () => ({ doc: () => ({}) });

  for (const [action, payload] of [
    ["rename", { name: "A2" }],
    ["set_level", { level: "viewer" }],
    ["set_active", { isActive: false }],
    ["delete", {}],
  ]) {
    await assert.rejects(
      manageAccountInTransaction({
        transaction,
        db: {},
        brandId: "cyj",
        roleId: "director",
        action,
        targetAccountId: "d1",
        payload,
        managementKey: "master-key",
        nowText: "2026-09-12T12:00:00.000Z",
        actorCheck: { actorAccountId: "d1", actorName: "A" },
        getBrandCollection,
        getBrandSettingDoc,
      }),
      (error) => error?.code === "self_account_admin_action_not_allowed",
    );
  }

  assert.equal(writes, 0);
});

test("director incident fix keeps app version while master_auth is now explicitly backend-only", () => {
  assert.match(app, /CURRENT_APP_VERSION\s*=\s*"3\.6\.0"/);
  assert.match(rules, /function signedIn\(\)\s*\{\s*return request\.auth != null;/);
  assert.doesNotMatch(rules, /request\.auth\.token\.drcyjIdentity/);
  assert.match(rules, /match \/brands\/\{brandId\}\/settings\/master_auth\s*\{\s*allow read, write:\s*if false;/);
  assert.match(rules, /settingId != 'master_auth'/);
  assert.match(backend, /serviceAccount:\s*ACCOUNT_AUTHORITY_RUNTIME_SERVICE_ACCOUNT/);
});

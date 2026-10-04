import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const app = fs.readFileSync("src/App.jsx", "utf8");
const monitor = fs.readFileSync("src/components/SystemMonitor.jsx", "utf8");
const authority = fs.readFileSync("functions/administrativeSettingsAuthority.js", "utf8");
const rules = fs.readFileSync("firestore.rules", "utf8");

test("Release Control is an on-demand CYJ super-admin action that reuses existing release identity", () => {
  assert.match(monitor, /發布更新/);
  assert.match(monitor, /發布全系統更新/);
  assert.ok(monitor.includes('String(currentBrand?.id || "") === "cyj"'));
  assert.match(monitor, /canManageDeviceSecurity/);
  assert.ok(monitor.includes('currentDeviceTrust?.status === "trusted"'));
  assert.match(monitor, /manageAdministrativeSettingAction/);
  assert.match(monitor, /action:\s*"publish_system_version"/);
  assert.ok(monitor.includes('releasePublishVersion.trim() !== String(releaseIdentity.publishedRelease?.appVersion || "")'));
  assert.match(monitor, /本機試跑完成：已驗證發布流程，但沒有寫入正式 system_version/);
  assert.doesNotMatch(monitor, /setInterval\([^)]*releasePublish/i);
  assert.doesNotMatch(monitor, /onSnapshot\([^)]*releasePublish/i);
});

test("Release Control removes automatic publishing from App startup", () => {
  assert.doesNotMatch(
    app,
    /manageAdministrativeSettingAction\(\{[\s\S]{0,180}action:\s*"publish_system_version"[\s\S]{0,180}CURRENT_APP_VERSION/
  );
  assert.match(monitor, /action:\s*"publish_system_version"/);
});

test("Release Control makes entry-asset identity part of the existing forced-update marker", () => {
  assert.match(app, /setPublishedSystemRelease/);
  assert.match(app, /remoteEntryAsset/);
  assert.match(app, /getLoadedEntryAsset\(\)/);
  assert.match(app, /remoteEntryAsset !== loadedEntryAsset/);
  assert.match(app, /fetchPublishedReleaseIdentity\(\)/);
  assert.match(app, /currentPublishedRelease\?\.entryAsset === remoteEntryAsset/);
  assert.match(app, /if \(marker\.version \|\| marker\.entryAsset\) void checkAndExecuteUpdate\(marker\)/);
});

test("Release Control backend verifies canonical deployed release, OCC and monotonic version before writing", () => {
  assert.match(authority, /PUBLISHED_RELEASE_IDENTITY_URL/);
  assert.match(authority, /fetchPublishedReleaseIdentity\(\)/);
  assert.match(authority, /system_version_not_deployed_release/);
  assert.match(authority, /release_identity_changed/);
  assert.match(authority, /currentRevision !== expectedRevision/);
  assert.match(authority, /system_version_downgrade_forbidden/);
  assert.match(authority, /brandId !== "cyj"/);
  assert.match(authority, /releaseSourceCommit:\s*publishedRelease\.sourceCommit/);
  assert.match(authority, /entryAsset:\s*publishedRelease\.entryAsset/);
  assert.match(authority, /revision:\s*nextRevision/);
});

test("Release Control does not reopen Browser writes to system_version", () => {
  assert.match(rules, /settingId != 'system_version'/);
  assert.doesNotMatch(monitor, /\bsetDoc\s*\(/);
  assert.doesNotMatch(monitor, /\bupdateDoc\s*\(/);
});

test("Release Control adds no new Firestore listener, query or polling", () => {
  assert.doesNotMatch(monitor, /\bonSnapshot\s*\(/);
  assert.doesNotMatch(monitor, /\bsetInterval\s*\(/);
  assert.doesNotMatch(monitor, /\bquery\s*\([^)]*system_version/i);
  const appVersionListenerCount = (app.match(/onSnapshot\(globalVersionRef/g) || []).length;
  assert.equal(appVersionListenerCount, 1);
});

test("Release Control first production rollout uses explicitly approved v3.6.2 cutover", () => {
  assert.match(app, /const CURRENT_APP_VERSION = "3\.6\.2";/);
  assert.doesNotMatch(
    app,
    /manageAdministrativeSettingAction\(\{[\s\S]{0,180}action:\s*"publish_system_version"[\s\S]{0,180}CURRENT_APP_VERSION/
  );
});

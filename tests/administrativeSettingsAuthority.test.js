import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const authority = require("../functions/administrativeSettingsAuthority.js");

const rules = fs.readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const settings = fs.readFileSync(new URL("../src/components/SettingsView.jsx", import.meta.url), "utf8");
const monitor = fs.readFileSync(new URL("../src/components/SystemMonitor.jsx", import.meta.url), "utf8");
const backend = fs.readFileSync(new URL("../functions/index.js", import.meta.url), "utf8");
const authoritySource = fs.readFileSync(new URL("../functions/administrativeSettingsAuthority.js", import.meta.url), "utf8");

test("P0-FINAL-1D-A1 administrative settings authority normalizes security configuration", () => {
  const result = authority.normalizeSecurityConfig({
    lowPowerEnabled: true,
    lowPowerIdleMinutes: 45,
    autoLogoutEnabled: false,
    autoLogoutMinutes: 300,
    logoutWarningSeconds: 90,
    deviceApprovalMode: "enforce",
    deviceApprovalRoles: ["director", "manager", "invalid"],
    deviceApprovalExpiryMinutes: 20,
    allowTrustedDeviceSelfApproval: false,
  });

  assert.equal(result.lowPowerIdleMinutes, 45);
  assert.equal(result.autoLogoutEnabled, false);
  assert.equal(result.enabled, false);
  assert.equal(result.timeoutMinutes, 300);
  assert.equal(result.warningSeconds, 90);
  assert.deepEqual(result.deviceApprovalRoles, ["director", "manager"]);
  assert.equal(result.allowTrustedDeviceSelfApproval, false);
});

test("P0-FINAL-1D-A1 feature flag authority retires arbitrary browser payload fields", () => {
  assert.deepEqual(
    authority.normalizeFeatureFlags({
      therapistModuleEnabled: false,
      annualAverageSettings: { legacy: true },
      injected: "no",
    }),
    { therapistModuleEnabled: false }
  );
});

test("P0-FINAL-1D-A1 KPI authority preserves missing newASP and validates benchmark ranges server-side", () => {
  const result = authority.normalizeKpiTargets({
    newASP: null,
    trafficASP: 1200,
    benchmarks: {
      default: {
        financial: { min: "0.8", max: "1" },
      },
    },
  }, "cyj");

  assert.equal(result.newASP, null);
  assert.equal(result.trafficASP, 1200);
  assert.equal(result.benchmarks.default.financial.min, 0.8);
  assert.equal(result.benchmarks.default.financial.max, 1);

  assert.throws(
    () => authority.normalizeKpiTargets({
      newASP: null,
      trafficASP: 1200,
      benchmarks: { default: { financial: { min: 1, max: 1 } } },
    }, "cyj"),
    /invalid_benchmark_range/,
  );

  assert.throws(
    () => authority.normalizeKpiTargets({
      newASP: null,
      trafficASP: 1200,
      benchmarks: { default: { financial: { min: 0.8 } } },
    }, "cyj"),
    /invalid_benchmark_range/,
  );
});

test("P0-FINAL-1D-A1 missing newASP is deleted by Backend authority instead of persisted as null", () => {
  assert.match(authoritySource, /deleteNewAsp:\s*newASP === null/);
  assert.match(authoritySource, /if \(deleteNewAsp\) payload\.newASP = fieldValue\.delete\(\)/);
});

test("P0-FINAL-1D-A1 backend requires Application Identity + Trusted Device + fresh credential + OCC", () => {
  assert.match(authoritySource, /requireFirebaseRequestAuth/);
  assert.match(authoritySource, /assertAdminApplicationClaims/);
  assert.match(authoritySource, /verifySuperAdminActor/);
  assert.match(authoritySource, /setting_revision_conflict/);
  assert.match(authoritySource, /db\.runTransaction/);
  assert.match(authoritySource, /expectedRevision/);
  assert.match(authoritySource, /revision:\s*nextRevision/);
});

test("P0-FINAL-1D-A1 index exports only the new administrative authority function", () => {
  assert.match(backend, /createAdministrativeSettingsAuthorityFunctions/);
  assert.match(backend, /exports\.manageAdministrativeSetting\s*=/);
});

test("P0-FINAL-1D-A1 SettingsView cuts admin settings writers over to backend", () => {
  assert.match(settings, /manageAdministrativeSettingAction/);
  assert.match(settings, /action:\s*"update_kpi_targets"/);
  assert.match(settings, /action:\s*"update_security_config"/);
  assert.match(settings, /action:\s*"update_feature_flags"/);

  assert.doesNotMatch(settings, /setDoc\(getDocPath\("security_config"\)/);
  assert.doesNotMatch(settings, /setDoc\(getDocPath\("feature_flags"\)/);
  assert.doesNotMatch(settings, /updateDoc\(getDocPath\("kpi_targets"\)/);
});

test("Release Control removes automatic system_version publishing and keeps Browser writes backend-only", () => {
  assert.match(app, /ADMINISTRATIVE_SETTINGS_ENDPOINT/);
  assert.match(app, /manageAdministrativeSettingAction/);
  assert.doesNotMatch(
    app,
    /manageAdministrativeSettingAction\(\{[\s\S]{0,160}action:\s*"publish_system_version"[\s\S]{0,160}CURRENT_APP_VERSION/
  );
  assert.doesNotMatch(app, /setDoc\(globalVersionRef,\s*\{\s*version:\s*CURRENT_APP_VERSION/);

  assert.match(monitor, /action:\s*"publish_system_version"/);
  assert.match(monitor, /expectedRevision:\s*Number\(releaseMarker\?\.revision/);
  assert.match(monitor, /releaseSourceCommit:\s*target\.sourceCommit/);
  assert.match(monitor, /entryAsset:\s*target\.entryAsset/);
});


test("Release Control validates only stable deployed semantic versions", () => {
  assert.equal(authority.normalizeStableVersion("3.6.2"), "3.6.2");
  assert.equal(authority.normalizeStableVersion("3.6.2-beta.1"), "");
  assert.equal(authority.compareStableVersions("3.6.2", "3.6.1"), 1);
  assert.equal(authority.compareStableVersions("3.6.1", "3.6.1"), 0);
  assert.equal(authority.compareStableVersions("3.5.9", "3.6.0"), -1);
});

test("Release Control validates canonical release identity", () => {
  const release = authority.normalizeReleaseIdentity({
    schemaVersion: "release-identity-v1",
    appVersion: "3.6.2",
    sourceCommit: "a".repeat(40),
    entryAsset: "assets/index-AbCd1234.js",
  });
  assert.equal(release.appVersion, "3.6.2");
  assert.equal(release.sourceCommit, "a".repeat(40));
  assert.equal(release.entryAsset, "assets/index-AbCd1234.js");

  assert.throws(
    () => authority.normalizeReleaseIdentity({
      schemaVersion: "release-identity-v1",
      appVersion: "3.6.2",
      sourceCommit: "bad",
      entryAsset: "assets/index-AbCd1234.js",
    }),
    /release_identity_invalid/
  );
});

test("Release Control fetches release.json with a cache-busting request", async () => {
  let requestedUrl = "";
  let requestedOptions = null;
  const release = await authority.fetchCanonicalPublishedReleaseIdentity({
    url: "https://example.test/app/release.json",
    now: 24680,
    fetchImpl: async (url, options) => {
      requestedUrl = url;
      requestedOptions = options;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          schemaVersion: "release-identity-v1",
          appVersion: "3.6.2",
          sourceCommit: "b".repeat(40),
          entryAsset: "assets/index-Release123.js",
        }),
      };
    },
  });

  assert.equal(release.appVersion, "3.6.2");
  assert.match(requestedUrl, /release\.json\?release_control=24680$/);
  assert.equal(requestedOptions.method, "GET");
  assert.equal(requestedOptions.headers["Cache-Control"], "no-cache");
});

test("Release Control backend binds system_version to canonical release identity with OCC and downgrade protection", () => {
  assert.match(authoritySource, /brandId !== "cyj"/);
  assert.match(authoritySource, /system_version_global_control_requires_cyj/);
  assert.match(authoritySource, /fetchPublishedReleaseIdentity\(\)/);
  assert.match(authoritySource, /system_version_not_deployed_release/);
  assert.match(authoritySource, /release_identity_changed/);
  assert.match(authoritySource, /currentRevision !== expectedRevision/);
  assert.match(authoritySource, /system_version_downgrade_forbidden/);
  assert.match(authoritySource, /releaseSourceCommit:\s*publishedRelease\.sourceCommit/);
  assert.match(authoritySource, /entryAsset:\s*publishedRelease\.entryAsset/);
  assert.match(authoritySource, /revision:\s*nextRevision/);
});

test("P0-FINAL-1D-A1 Rules make administrative settings browser-read-only", () => {
  assert.match(rules, /match \/brands\/\{brandId\}\/settings\/security_config[\s\S]{0,180}allow write: if false;/);
  assert.match(rules, /match \/brands\/\{brandId\}\/settings\/feature_flags[\s\S]{0,180}allow write: if false;/);
  assert.match(rules, /match \/brands\/\{brandId\}\/settings\/kpi_targets[\s\S]{0,180}allow write: if false;/);

  assert.match(rules, /settingId != 'system_version'/);
  assert.match(rules, /settingId != 'security_config'/);
  assert.match(rules, /settingId != 'feature_flags'/);
  assert.match(rules, /settingId != 'kpi_targets'/);

  assert.match(rules, /match \/brands\/\{brandId\}\/settings\/\{settingId\}\/\{document=\*\*\}[\s\S]{0,900}settingId != 'security_config'[\s\S]{0,300}settingId != 'feature_flags'[\s\S]{0,300}settingId != 'kpi_targets'/);
  const genericBrandFallback = rules.match(
    /match \/brands\/\{brandId\}\/\{collectionName\}\/\{document=\*\*\} \{([\s\S]*?)\n    \}/
  );
  assert.ok(genericBrandFallback, "generic brand fallback rule must exist");
  assert.match(genericBrandFallback[1], /collectionName != 'settings'/);
  assert.doesNotMatch(rules, /collectionName == 'settings' && document == 'security_config'/);
});

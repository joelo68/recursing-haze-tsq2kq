import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const authority = require("../functions/administrativeSettingsAuthority.js");

const rules = fs.readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const settings = fs.readFileSync(new URL("../src/components/SettingsView.jsx", import.meta.url), "utf8");
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

test("P0-FINAL-1D-A1 App cuts system_version browser writer over to backend", () => {
  assert.match(app, /ADMINISTRATIVE_SETTINGS_ENDPOINT/);
  assert.match(app, /manageAdministrativeSettingAction/);
  assert.match(app, /action:\s*"publish_system_version"/);
  assert.doesNotMatch(app, /setDoc\(globalVersionRef,\s*\{\s*version:\s*CURRENT_APP_VERSION/);
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
  assert.match(rules, /match \/brands\/\{brandId\}\/\{collectionName\}\/\{document=\*\*\}[\s\S]{0,1200}collectionName != 'settings'/);
  assert.doesNotMatch(rules, /collectionName == 'settings' && document == 'security_config'/);
});

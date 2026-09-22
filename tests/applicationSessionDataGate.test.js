import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const appPath = path.join(repoRoot, "src", "App.jsx");
const gatePath = path.join(repoRoot, "src", "components", "DeviceApprovalGate.jsx");

const app = fs.readFileSync(appPath, "utf8");
const deviceGate = fs.readFileSync(gatePath, "utf8");

const sliceBetween = (startToken, endToken) => {
  const start = app.indexOf(startToken);
  const end = app.indexOf(endToken, start + startToken.length);
  assert.ok(start >= 0, `missing start token: ${startToken}`);
  assert.ok(end > start, `missing end token after ${startToken}: ${endToken}`);
  return app.slice(start, end);
};

test("application identity becomes a reactive verified-session gate", () => {
  assert.match(
    app,
    /const \[applicationSessionIdentity, setApplicationSessionIdentity\] = useState\(null\);/
  );
  assert.match(app, /const hasVerifiedApplicationSession = useMemo\(\(\) => \{/);
  assert.match(app, /identityBrandId === brandId/);
  assert.match(app, /identityRoleId === roleId/);
  assert.match(app, /identityUid\s*&&\s*identityAccountId\s*&&\s*brandId\s*&&\s*roleId/);
  assert.match(app, /setApplicationSessionIdentity\(verifiedSessionIdentity\)/);

  const clearCount = (app.match(/setApplicationSessionIdentity\(null\);/g) || []).length;
  assert.ok(clearCount >= 3, `expected verified session to clear on authority exit, found ${clearCount}`);
});

test("login bootstrap keeps only login-required Firestore data", () => {
  const bootstrap = sliceBetween(
    "const fetchGlobalData = useCallback",
    "// P0-FINAL-1B：正式營運 authority"
  );

  assert.doesNotMatch(bootstrap, /getDoc\(getDocPath\("org_structure"\)\)/);
  assert.match(bootstrap, /assertSanitizedLoginOrganization\(directoryResult\.organization, brandIdAtStart\)/);
  assert.match(bootstrap, /LOGIN_DIRECTORY_ENDPOINT/);

  for (const forbidden of [
    'getDoc(getDocPath("permissions"))',
    'getDoc(getDocPath("security_config"))',
    'getDoc(getDocPath("feature_flags"))',
    'getCollectionPath("management_delegations")',
  ]) {
    assert.equal(
      bootstrap.includes(forbidden),
      false,
      `pre-login bootstrap must not fetch ${forbidden}`
    );
  }

  assert.match(bootstrap, /fetchGlobalData_core_docs", 0/);
});

test("session authority is loaded only after server-issued application identity", () => {
  const authority = sliceBetween(
    "const fetchApplicationSessionAuthority = useCallback",
    "// B1C2E-2：只有登入畫面監聽 1 份 sanitized directory summary。"
  );

  assert.match(authority, /applicationSessionIdentityRef\.current/);
  assert.match(authority, /getDoc\(getDocPath\("permissions"\)\)/);
  assert.match(authority, /getDoc\(getDocPath\("security_config"\)\)/);
  assert.match(authority, /getDoc\(getDocPath\("feature_flags"\)\)/);
  assert.match(authority, /getCollectionPath\("management_delegations"\)/);
  assert.match(authority, /application_session_authority_docs/);

  const login = sliceBetween(
    "const handleLogin = useCallback",
    "const resumePendingDeviceLogin"
  );
  assert.match(login, /const activatedIdentity = await activateApplicationIdentitySession/);
  assert.match(login, /await fetchApplicationSessionAuthority\(activatedIdentity\)/);
});

test("operational App reads are gated by verified application session", () => {
  const requiredPatterns = [
    /if \(!hasVerifiedApplicationSession \|\| !brandId\) return undefined;/,
    /if \(!hasVerifiedApplicationSession\) return;\s+const unsubReadTrackerConfig/,
    /const shouldKeepMonthlyTargetsLive =\s+Boolean\(hasVerifiedApplicationSession\)/,
    /if \(!shouldLoadMonthlyTargets \|\| !hasVerifiedApplicationSession\)/,
    /if \(!hasVerifiedApplicationSession\) \{\s+setTargets\(/,
    /if \(!hasVerifiedApplicationSession \|\| !selectedYearMonth\) \{\s+setMonthlyTargetSummary/,
    /if \(!hasVerifiedApplicationSession \|\| !shouldLoadCurrentLifecycleMaster\)/,
    /if \(!hasVerifiedApplicationSession \|\| !selectedYearMonth\) \{\s+setCurrentDashboardSummary/,
    /if \(!hasVerifiedApplicationSession\) return;\s+const targetYearStr/,
    /if \(!hasVerifiedApplicationSession\) \{\s+setDailyLoginCount/,
    /if \(!hasVerifiedApplicationSession \|\| !selectedYearMonth\) \{\s+setCurrentSummaryRecalcFlagState/,
    /if \(!hasVerifiedApplicationSession \|\| !selectedYearMonth\) return undefined;/,
    /if \(!hasVerifiedApplicationSession \|\| isLowPowerMode \|\| \(!shouldLoadDailyReportData/,
    /if \(!hasVerifiedApplicationSession\) return \[\];\s+const includeHistory/,
  ];

  for (const pattern of requiredPatterns) {
    assert.match(app, pattern);
  }

  const annualGateCount = (
    app.match(
      /const shouldLoadAnnualData = ANNUAL_DATA_VIEWS\.has\(activeView\);\s+if \(!hasVerifiedApplicationSession\) \{/g
    ) || []
  ).length;
  assert.equal(annualGateCount, 3);
});

test("intentional pre-login surfaces remain narrow", () => {
  assert.match(
    app,
    /Boolean\(user && hasSelectedBrand && !userRole && !pendingDeviceLogin && brandId\)/
  );
  assert.match(app, /getCollectionPath\("login_directory_summary"\), "current"/);
  assert.match(app, /getCollectionPath\("device_approval_requests"\), pendingDeviceLogin\.requestId/);
  assert.match(deviceGate, /return onSnapshot\(requestRef,/);
});

test("application version and identity cutover remain unchanged", () => {
  assert.match(app, /const CURRENT_APP_VERSION = "3\.6\.0";/);
  assert.match(app, /signInWithCustomToken\(auth, customToken\)/);
  assert.match(app, /claims\?\.drcyjIdentity === true/);
});

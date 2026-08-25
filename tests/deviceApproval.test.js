import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const backend = read("functions/deviceApproval.js");
const app = read("src/App.jsx");
const login = read("src/components/LoginView.jsx");
const settings = read("src/components/SettingsView.jsx");
const monitor = read("src/components/SystemMonitor.jsx");
const gate = read("src/components/DeviceApprovalGate.jsx");
const panel = read("src/components/DeviceApprovalPanel.jsx");
const rules = read("firestore.rules");

test("new device protection defaults to off and covers all current roles", () => {
  assert.match(backend, /deviceApprovalMode:\s*'off'/);
  assert.match(backend, /deviceApprovalRoles:\s*\['director', 'trainer', 'manager', 'store', 'therapist'\]/);
  assert.match(backend, /deviceApprovalExpiryMinutes:\s*15/);
  assert.match(app, /CURRENT_APP_VERSION\s*=\s*"3\.5\.2"/);
});

test("backend verifies Firebase request auth and application credential before device decision", () => {
  assert.match(backend, /requireFirebaseRequestAuth\(req, admin\)/);
  assert.match(backend, /admin\.auth\(\)\.verifyIdToken\(token\)/);
  assert.match(backend, /verifyApplicationCredential\(\{ db, brandId, roleId, accountId: accountIdInput, password \}\)/);
  assert.match(app, /Authorization:\s*`Bearer \$\{idToken\}`/);
  assert.match(app, /credentialRejected\s*=\s*error\?\.status\s*===\s*401/);
  assert.match(app, /const mustBlock = shouldFailClosed/);
});

test("existing trusted devices remain grandfathered while recoverable devices do not auto-inherit trust in approval mode", () => {
  const exactTrustedPos = backend.indexOf("const exactDeviceIsTrusted");
  const modeOffPos = backend.indexOf("if (!modeApplies)");
  const approvalRequestPos = backend.indexOf("const request = await createOrRefreshApprovalRequest");
  assert.ok(exactTrustedPos >= 0 && exactTrustedPos < modeOffPos, "Exact trusted-device check must happen before approval-mode branching.");
  assert.ok(approvalRequestPos > modeOffPos, "Approval request must occur after the legacy off-mode branch.");
  assert.match(backend, /likelyKnownDevice:\s*Boolean\(recovered \|\| reviewRecovered\)/);
  assert.match(backend, /approvalRequired:\s*true/);
});

test("trusted-device self approval requires a different trusted device plus current credential", () => {
  assert.match(backend, /String\(actor\.deviceId \|\| ''\) === String\(requestData\.deviceId \|\| ''\)/);
  assert.match(backend, /verifyTrustedApproverDevice\(\{ db, brandId, roleId: requestData\.role, accountId: requestData\.accountId/);
  assert.match(backend, /accountId:\s*requestData\.credentialAccountId \|\| requestData\.accountId/);
  assert.match(backend, /password:\s*String\(actor\.credentialPassword \|\| ''\)/);
  assert.match(backend, /return isTrustedDeviceRecord\(device\)/);
  assert.match(app, /securitySessionCredentialRef\.current = String\(loginCredential\?\.password \|\| ""\)/);
});

test("manual approval is limited to trusted super-admin or master credential", () => {
  assert.match(backend, /async function verifySuperAdminActor/);
  assert.match(backend, /verifyTrustedApproverDevice\(\{ db, brandId, roleId: 'director'/);
  assert.match(backend, /credential\.isMasterCredential/);
  assert.match(backend, /credential\.directorLevel \|\| ''\) !== 'super_admin'/);
  assert.match(panel, /isSuperAdmin && currentDeviceTrusted/);
});

test("backend mirrors current director-level fallback so legacy top executives keep super-admin approval rights", () => {
  assert.match(backend, /function getDefaultDirectorLevel\(name = ''\)/);
  assert.match(backend, /text\.includes\('董事長'\) \|\| text\.includes\('總經理'\)/);
  assert.match(backend, /text\.includes\('財務'\)/);
  assert.match(backend, /level:\s*String\(account\.level \|\| account\.directorLevel \|\| getDefaultDirectorLevel/);
  assert.match(backend, /directorLevel:\s*String\(account\.level \|\| ''\)/);
});

test("global block is checked against both current and recoverable legacy device ids", () => {
  assert.match(backend, /const recoverableDevice = exactDevice \? null : findRecoverableKnownDeviceEntry/);
  assert.match(backend, /recoverableDevice\?\.storedDeviceId/);
  assert.match(backend, /const globalBlockSnaps = await Promise\.all/);
});

test("legacy exact devices with implicit trust stay grandfathered unless explicitly unsafe", () => {
  assert.match(backend, /const exactDeviceIsTrusted = isTrustedDeviceRecord\(exactDevice\)/);
  assert.match(backend, /const riskyStatus = \['new', 'observing', 'reverify_required', 'suspicious', 'blocked', 'global_blocked'\]\.includes\(status\)/);
  assert.match(backend, /const riskySource = \['manual_observing', 'manual_reverify_required', 'manual_suspicious', 'manual_blocked', 'manual_global_blocked', 'self_reported_not_me'\]\.includes\(source\)/);
  assert.match(backend, /return device\.trusted !== false && !riskyStatus && !riskySource/);
});



test("first-time accounts without another trusted device go directly to manager-assisted confirmation", () => {
  assert.match(backend, /const hasTrustedApproverDevice = Object\.entries\(devices \|\| \{\}\)\.some/);
  assert.match(backend, /!excludedApproverIds\.has\(storedDeviceId\) && isTrustedDeviceRecord\(item\)/);
  assert.match(backend, /selfApprovalAllowed = Boolean\(securityConfig\.allowTrustedDeviceSelfApproval\)[\s\S]*hasTrustedApproverDevice/);
  assert.match(backend, /hasTrustedApproverDevice,[\s\S]*adminOnly: !selfApprovalAllowed/);
  assert.match(gate, /目前這個帳號沒有其他可用的已信任裝置/);
});

test("recoverable risky devices cannot bypass block or suspicious review by changing browser storage id", () => {
  assert.match(backend, /function findRecoverableRiskDeviceEntry/);
  assert.match(backend, /recoverableRiskDevice\?\.storedDeviceId/);
  assert.match(backend, /blockedDeviceMatch/);
  assert.match(backend, /reviewRecovered/);
  assert.match(backend, /approvalExistingDevice\?\.status !== 'suspicious'/);
});

test("emergency recovery clears both current and legacy matching global block ids", () => {
  assert.match(app, /blockedDeviceId: pending\.blockedDeviceId \|\| pending\.blockedData\?\.deviceId/);
  assert.match(backend, /blockedDeviceId = sanitizeSecurityKey\(body\.blockedDeviceId \|\| ''\)/);
  assert.match(backend, /recoverableRisk\?\.storedDeviceId/);
  assert.match(backend, /recoverableKnown\?\.storedDeviceId/);
  assert.match(backend, /Promise\.all\(globalDeviceIds\.map/);
});

test("highest manager can distinguish observing from required re-verification", () => {
  assert.match(panel, /observe_admin/);
  assert.match(panel, /繼續觀察/);
  assert.match(panel, /reverify_admin/);
  assert.match(panel, /要求重新驗證/);
  assert.match(backend, /action === 'observe_admin'/);
  assert.match(backend, /status: 'observing', source: 'manual_observing'/);
  assert.match(backend, /action === 'reverify_admin'/);
  assert.match(backend, /status: 'reverify_required', source: 'manual_reverify_required'/);
});

test("approval codes are hashed in a private subdocument and hidden when self approval is disabled", () => {
  assert.match(backend, /requestRef\.collection\('private'\)\.doc\('verification'\)/);
  assert.match(backend, /codeHash/);
  assert.match(backend, /salt/);
  assert.match(backend, /verificationCode:\s*selfApprovalAllowed \? request\.verificationCode : ''/);
  assert.match(backend, /if \(resolvedSelfApprovalAllowed\) \{[\s\S]*transaction\.set\(secretRef/);
  assert.match(backend, /else \{\s*transaction\.delete\(secretRef\)/);
  assert.doesNotMatch(backend, /transaction\.set\(requestRef,[\s\S]{0,1600}verificationCode\s*:/);
});

test("same account and device reuse one deterministic active request and pending counts cannot go below zero", () => {
  assert.match(backend, /makeRequestId\(brandId, accountKey, deviceInfo\.deviceId\)/);
  assert.match(backend, /alreadyPending = existingRequest\.status === 'pending'/);
  assert.match(backend, /if \(!alreadyPending\) \{/);
  assert.match(backend, /Math\.max\(0, Number\(inboxSnap\?\.data\(\)\?\.pendingCount \|\| 0\) \+ Number\(delta \|\| 0\)\)/);
});

test("expired requests preserve reviewed non-trusted status", () => {
  assert.match(backend, /cleanupExpiredDeviceApprovals = onSchedule\(\{ schedule: 'every 15 minutes'/);
  assert.match(backend, /deviceStatus:\s*targetStatus/);
  assert.match(backend, /\['observing', 'reverify_required', 'suspicious'\]\.includes/);
  assert.match(backend, /Date\.now\(\) > Number\(requestData\.expiresAtMs \|\| 0\)/);
});

test("store accounts keep their real account id for security inbox lookup", () => {
  assert.match(app, /loginAccountId = String\([\s\S]*loginCredential\?\.accountId/);
  assert.match(app, /securityAccountId:\s*loginAccountId/);
  assert.match(app, /currentUser\?\.securityAccountId \|\| currentUser\?\.id/);
});

test("header uses small approval summaries rather than loading full device history", () => {
  assert.match(app, /device_approval_inbox/);
  assert.match(app, /getSecuritySummaryDocPath\("device_approvals"\)/);
  assert.match(app, /openDeviceApprovalPanel/);
  assert.doesNotMatch(app, /refreshDeviceAlertSummary/);
});

test("security center keeps full device history manual-load and adds a dedicated pending-device view", () => {
  assert.match(monitor, /setMonitorMode\("approvals"\)/);
  assert.match(monitor, /<DeviceApprovalPanel/);
  assert.match(monitor, /onClick=\{fetchDeviceProfiles\}/);
  assert.match(monitor, /進入裝置管理時不會自動載入完整紀錄/);
  assert.doesNotMatch(monitor, /為節省 reads/);
  assert.doesNotMatch(monitor, /為節省 reads|自動讀取 account_devices|載入 account_devices/);
});

test("settings expose user-friendly off, monitor and enforce rollout choices", () => {
  assert.match(settings, /title:\s*"維持目前方式"/);
  assert.match(settings, /title:\s*"先觀察"/);
  assert.match(settings, /title:\s*"正式啟用"/);
  assert.match(settings, /確定要正式啟用新裝置登入保護嗎/);
  assert.match(settings, /本人可用舊裝置完成確認/);
});

test("approval UI uses non-engineering wording and requires manager help when self approval is unavailable", () => {
  assert.match(gate, /這台裝置需要先確認/);
  assert.match(gate, /這台裝置需要由最高管理者協助確認/);
  assert.match(panel, /是我本人，允許使用/);
  assert.match(panel, /不是我，交由最高管理者處理/);
  assert.doesNotMatch(gate, /Device fingerprint mismatch|Pending approval request|Firestore collection|request ID|codeHash/i);
});

test("protected security collections cannot be written directly by frontend broad rules", () => {
  for (const name of [
    "account_devices",
    "device_approval_requests",
    "device_approval_inbox",
    "security_alerts",
    "security_summary",
  ]) {
    assert.match(rules, new RegExp(`collectionName != '${name}'`));
  }
  assert.match(rules, /collectionName != 'global_blocked_devices'/);
  assert.match(rules, /match \/brands\/\{brandId\}\/account_devices\/\{document=\*\*\}[\s\S]*?allow write: if false;/);
  assert.match(rules, /match \/artifacts\/\{appId\}\/public\/data\/global_blocked_devices\/\{document=\*\*\}[\s\S]*?allow read, write: if false;/);
});

test("legacy frontend recovery and auto-trust policy are removed from App after backend takeover", () => {
  assert.doesNotMatch(app, /findRecoverableKnownDeviceEntry/);
  assert.doesNotMatch(app, /SECURITY_DEVICE_CONFIG/);
  assert.doesNotMatch(app, /autoTrustLimit/);
});

test("frontend no longer directly mutates protected device-security collections", () => {
  const frontend = [app, monitor, panel, gate].join("\n");
  assert.doesNotMatch(frontend, /setDoc\([^\n]{0,240}(account_devices|device_approval_requests|device_approval_inbox|security_alerts|security_summary|global_blocked_devices)/);
  assert.doesNotMatch(frontend, /addDoc\([^\n]{0,240}(security_alerts|device_approval_requests)/);
});

test("LoginView forwards the credential to App for every supported role after client-side password check", () => {
  for (const role of ["director", "trainer", "manager", "store", "therapist"]) {
    assert.match(login, new RegExp(`await onLogin\\("${role}"`));
  }
  assert.match(login, /await onLogin\(loginRole, loginPayload, \{ accountId: forcePasswordUpdate\.accountId, password: nextPass \}\)/);
});

test("monitor-mode device badge becomes trusted live after approval without relogin", () => {
  assert.match(app, /approvalRequestId:\s*approvalRequired \? String\(deviceSecurity\?\.requestId \|\| ""\) : ""/);
  assert.match(app, /getCollectionPath\("device_approval_requests"\)/);
  assert.match(app, /requestStatus === "approved"/);
  assert.match(app, /status:\s*"trusted"[\s\S]{0,180}label:\s*"🛡 目前裝置已信任"/);
  assert.match(app, /approvalRequestId:\s*""/);
});

test("mobile pending badge reconciles automatically when approval count clears or page returns to foreground", () => {
  assert.match(app, /previousMyPendingCountRef/);
  assert.match(app, /previousCount > 0 && nextCount === 0 && stillWaiting/);
  assert.match(app, /refreshCurrentDeviceApprovalStatus\("pending-count-cleared"\)/);
  assert.match(app, /await getDoc\(requestRef\)/);
  assert.match(app, /document\.addEventListener\("visibilitychange", handleVisibilityChange\)/);
  assert.match(app, /window\.addEventListener\("focus", refreshIfVisible\)/);
  assert.match(app, /window\.addEventListener\("pageshow", refreshIfVisible\)/);
  assert.match(app, /now - Number\(state\.lastCheckedAt \|\| 0\) < 1200/);
  assert.match(app, /applyCurrentDeviceApprovalResult\(requestId, snap\.data\(\) \|\| \{\}\)/);
  assert.doesNotMatch(app, /setInterval\([\s\S]{0,500}refreshCurrentDeviceApprovalStatus/);
});


test("device review levels separate observing, reverify, and blocked states", () => {
  const backend = read("functions/deviceApproval.js");
  const panel = read("src/components/DeviceApprovalPanel.jsx");
  const monitor = read("src/components/SystemMonitor.jsx");
  const app = read("src/App.jsx");

  assert.match(backend, /status:\s*'observing'[\s\S]{0,100}source:\s*'manual_observing'/);
  assert.match(backend, /status:\s*'reverify_required'[\s\S]{0,140}source:\s*'manual_reverify_required'/);
  assert.match(backend, /deviceApprovalMode === 'monitor'[\s\S]{0,1600}\['observing', 'reverify_required'\]/);
  assert.match(panel, /runAction\(request, "observe_admin"\)/);
  assert.match(panel, /繼續觀察/);
  assert.match(panel, /runAction\(request, "reverify_admin"\)/);
  assert.match(panel, /要求重新驗證/);
  assert.match(monitor, /updateDeviceTrust\(profile, device, "observing"\)/);
  assert.match(monitor, /updateDeviceTrust\(profile, device, "reverify_required"\)/);
  assert.match(app, /主管要求重新驗證/);
  assert.match(app, /新裝置待觀察/);
  assert.match(app, /CURRENT_APP_VERSION\s*=\s*"3\.5\.2"/);
});

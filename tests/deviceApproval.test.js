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
const functionsIndex = read("functions/index.js");
const telegramCenter = read("src/components/TelegramAlertControlCenter.jsx");

test("new device protection defaults to off and covers all current roles", () => {
  assert.match(backend, /deviceApprovalMode:\s*'off'/);
  assert.match(backend, /deviceApprovalRoles:\s*\['director', 'trainer', 'manager', 'store', 'therapist'\]/);
  assert.match(backend, /deviceApprovalExpiryMinutes:\s*15/);
  assert.match(app, /CURRENT_APP_VERSION\s*=\s*"3\.5\.3"/);
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



test("super-admin own new device must use the six-digit self-approval flow", () => {
  assert.doesNotMatch(panel, /const canSelfApprove = !isSuperAdmin && isMyRequest && currentDeviceTrusted/);
  assert.match(panel, /const canSelfApprove = isMyRequest && currentDeviceTrusted && request\.selfApprovalAllowed !== false/);
  assert.match(panel, /const canAdminReview = isSuperAdmin && currentDeviceTrusted && \(!isMyRequest \|\| request\.selfApprovalAllowed === false\)/);
  assert.match(panel, /\{!guided && canAdminReview && \(/);
  assert.match(panel, /runAction\(request, "approve_self"\)/);
  assert.match(backend, /actorAccountId:\s*String\(credential\.accountId \|\| accountId\)/);
  assert.match(backend, /action === 'approve_admin' && actorOwnsRequest && requestData\.selfApprovalAllowed !== false/);
  assert.match(backend, /自己的新裝置請使用原本已信任的裝置輸入 6 位確認碼完成驗證/);
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
  assert.match(panel, /不是我，立即阻止並通知管理者|確定不是我，立即阻止/);
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
  assert.match(app, /CURRENT_APP_VERSION\s*=\s*"3\.5\.3"/);
});

test("six-digit self verification allows only three failed attempts and reports remaining attempts", () => {
  assert.match(backend, /DEVICE_APPROVAL_MAX_FAILED_ATTEMPTS\s*=\s*3/);
  assert.match(backend, /failedAttempts\s*>=\s*DEVICE_APPROVAL_MAX_FAILED_ATTEMPTS/);
  assert.match(backend, /remainingAttempts\s*=\s*Math\.max\(0, DEVICE_APPROVAL_MAX_FAILED_ATTEMPTS - nextFailedAttempts\)/);
  assert.match(backend, /確認碼不正確，請重新確認。還可嘗試 \$\{remainingAttempts\} 次。/);
  assert.match(backend, /確認碼不正確，已達 \$\{DEVICE_APPROVAL_MAX_FAILED_ATTEMPTS\} 次上限。還可嘗試 0 次/);
  assert.match(backend, /remainingAttempts:\s*0/);
  assert.match(backend, /maxAttempts:\s*DEVICE_APPROVAL_MAX_FAILED_ATTEMPTS/);
  assert.doesNotMatch(backend, /failedAttempts \|\| 0\) >= 5/);
  assert.match(panel, /result\?\.message/);
});



test("password security telemetry alerts after three failures in ten minutes without storing submitted passwords", () => {
  assert.match(backend, /LOGIN_SECURITY_WINDOW_MS\s*=\s*10 \* 60 \* 1000/);
  assert.match(backend, /LOGIN_SECURITY_PASSWORD_FAIL_THRESHOLD\s*=\s*3/);
  assert.match(backend, /telegramSecurityType:\s*'password_failed_threshold'/);
  assert.match(backend, /const reportLoginSecurityEvent = onRequest/);
  assert.match(backend, /eventType !== 'password_failed'/);
  const start = backend.indexOf("async function recordFailedPasswordAttempt");
  const end = backend.indexOf("async function verifyApplicationCredential", start);
  const body = backend.slice(start, end > start ? end : start + 9000);
  assert.ok(body.length > 1000);
  assert.doesNotMatch(body, /enteredPassword|credentialPassword|password:\s*String/);
});

test("device security produces Telegram-worthy alerts only for meaningful manager or risk events", () => {
  assert.match(backend, /telegramSecurityType:\s*securityConfig\.deviceApprovalMode === 'enforce' && !resolvedSelfApprovalAllowed \? 'manager_assistance_required' : ''/);
  assert.match(backend, /alertType:\s*'device_code_failed_limit'/);
  assert.match(backend, /alertType:\s*'self_reported_not_me'/);
  assert.match(backend, /alertType:\s*'blocked_device_login'/);
  assert.match(backend, /alertType:\s*'rapid_multi_location_login'/);
});

test("rapid multi-location detection uses a ten-minute window and suppresses same-country mobile-network city drift", () => {
  assert.match(backend, /now - previous\.atMs <= LOGIN_SECURITY_WINDOW_MS/);
  assert.match(backend, /if \(!withinWindow \|\| !differentLocation\) return/);
  assert.match(backend, /if \(!a\.isMobileNetwork && !b\.isMobileNetwork && a\.area && b\.area && a\.area !== b\.area\) return true/);
  assert.match(backend, /if \(aCountry && bCountry && aCountry !== bCountry\) return true/);
});

test("login page reports failed passwords for every supported role without blocking the UI", () => {
  assert.match(app, /LOGIN_SECURITY_EVENT_ENDPOINT[\s\S]{0,250}reportLoginSecurityEvent/);
  assert.match(app, /onSecurityEvent=\{reportLoginSecurityEvent\}/);
  assert.match(login, /eventType:\s*"password_failed"/);
  for (const role of ["director", "trainer", "manager", "store", "therapist"]) {
    assert.match(login, new RegExp(`reportPasswordFailure\\("${role}"`));
  }
  assert.match(login, /Promise\.resolve\(onSecurityEvent/);
});

test("Telegram security alerts reuse the three recognized chats but remain disabled until a highest manager chooses targets", () => {
  assert.match(functionsIndex, /TARGET_CHAT_ID_MAIN\s*=\s*'-4991191955'/);
  assert.match(functionsIndex, /TARGET_CHAT_ID_MANAGER\s*=\s*'-1002361008620'/);
  assert.match(functionsIndex, /TARGET_CHAT_ID_AGENT_TEST\s*=\s*'-5241604208'/);
  assert.match(functionsIndex, /main:\s*\{ chatId: TARGET_CHAT_ID_MAIN, label: '高階主管主群' \}/);
  assert.match(functionsIndex, /manager:\s*\{ chatId: TARGET_CHAT_ID_MANAGER, label: '主管群' \}/);
  assert.match(functionsIndex, /agent_test:\s*\{ chatId: TARGET_CHAT_ID_AGENT_TEST, label: 'Agent 測試群' \}/);
  assert.match(telegramCenter, /createDefaultTelegramSecurityForm[\s\S]{0,120}enabled:\s*false[\s\S]{0,80}chatTargets:\s*\[\]/);
  assert.match(telegramCenter, /登入安全即時通知/);
  assert.match(telegramCenter, /高階主管主群/);
  assert.match(telegramCenter, /主管群/);
  assert.match(telegramCenter, /Agent 測試群/);
});

test("security alert Firestore triggers dispatch both CYJ legacy and brand events through the selected Telegram targets", () => {
  assert.match(functionsIndex, /exports\.onLegacySecurityAlertCreated = onDocumentCreated/);
  assert.match(functionsIndex, /artifacts\/default-app-id\/public\/data\/security_alerts\/\{alertId\}/);
  assert.match(functionsIndex, /exports\.onBrandSecurityAlertCreated = onDocumentCreated/);
  assert.match(functionsIndex, /brands\/\{brandId\}\/security_alerts\/\{alertId\}/);
  assert.match(functionsIndex, /TELEGRAM_SECURITY_CONFIG_REF/);
  assert.match(functionsIndex, /resolveTelegramSecurityChatIds/);
  assert.match(functionsIndex, /sendTelegramMessage\(chatId, message\)/);
  assert.match(functionsIndex, /exports\.reportLoginSecurityEvent = deviceApprovalFunctions\.reportLoginSecurityEvent/);
});

test("login security state is backend-only and cannot be altered through broad frontend Firestore rules", () => {
  assert.match(rules, /match \/brands\/\{brandId\}\/login_security_state\/\{document=\*\*\}[\s\S]*?allow read, write: if false;/);
  assert.match(rules, /match \/artifacts\/\{appId\}\/public\/data\/login_security_state\/\{document=\*\*\}[\s\S]*?allow read, write: if false;/);
  assert.match(rules, /collectionName != 'login_security_state'/);
});

test("guided self approval auto-opens only for enforce-mode trusted-device own pending requests", () => {
  assert.match(app, /guidedDeviceApprovalRequestId/);
  assert.match(app, /securityConfig\?\.deviceApprovalMode === "enforce"/);
  assert.match(app, /currentDeviceTrust\?\.status === "trusted"/);
  assert.match(app, /deviceApprovalSummary\?\.myPendingCount/);
  assert.match(app, /where\("accountKey", "==", currentSecurityAccountKey\)/);
  assert.match(app, /where\("status", "==", "pending"\)/);
  assert.match(app, /request\.selfApprovalAllowed !== false/);
  assert.match(app, /String\(request\.deviceId \|\| ""\) !== String\(currentDeviceTrust\?\.deviceId \|\| ""\)/);
  assert.match(app, /setIsDeviceApprovalPanelOpen\(false\)/);
  assert.match(app, /setGuidedDeviceApprovalRequestId\(String\(actionable\.id\)\)/);
});

test("guided approval UI blocks normal work until the own request is handled and does not depend on the header badge", () => {
  assert.match(panel, /guided = false/);
  assert.match(panel, /guidedRequestId = ""/);
  assert.match(panel, /新裝置正在等您確認/);
  assert.match(panel, /先完成這一筆確認，再開始使用系統/);
  assert.match(panel, /您剛才是否正在另一台裝置登入系統/);
  assert.match(panel, /是，我正在登入/);
  assert.match(panel, /確定不是我，立即阻止/);
  assert.match(panel, /輸入新裝置上的 6 位數字/);
  assert.match(panel, /確認這台新裝置/);
  assert.match(panel, /!embedded && !guided && event\.target === event\.currentTarget/);
  assert.match(panel, /!embedded && !guided && <button/);
  assert.match(panel, /onGuidedComplete\?\.\(\)/);
});

test("guided super-admin flow reads only the signed-in account instead of all brand pending requests", () => {
  const guidedBranch = panel.slice(panel.indexOf("if (guided && accountKey)"), panel.indexOf("} else if (isSuperAdmin)"));
  assert.match(guidedBranch, /where\("accountKey", "==", accountKey\)/);
  assert.match(guidedBranch, /where\("status", "==", "pending"\)/);
  assert.doesNotMatch(guidedBranch, /limit\(50\)/);
  assert.match(panel, /if \(guidedRequestId && row\.id !== guidedRequestId\) return false/);
  assert.match(panel, /row\.selfApprovalAllowed === false/);
  assert.match(panel, /String\(row\.deviceId \|\| ""\) === String\(currentDeviceId \|\| ""\)/);
});

test("new device gate tells ordinary users to return to the old device and wait for automatic guidance", () => {
  assert.match(gate, /系統會自動帶您完成確認/);
  assert.match(gate, /系統會主動顯示「新裝置確認」/);
  assert.match(gate, /不需要另外尋找右上角提醒/);
  assert.doesNotMatch(gate, /點右上角「待確認」/);
});

test("self-reported not-me immediately blocks the pending attempt and keeps Telegram escalation", () => {
  assert.match(panel, /runAction\(request, "reject_self"\)/);
  assert.match(panel, /已阻止這次新裝置登入，並通知最高管理者/);
  assert.match(backend, /action === 'reject_self'/);
  assert.match(backend, /status: 'suspicious', source: 'self_reported_not_me'/);
  assert.match(backend, /alertType: 'self_reported_not_me'/);
  assert.match(backend, /severity: 'critical'/);
});

test("third wrong six-digit code closes the stale pending request so the trusted device is not trapped", () => {
  assert.match(backend, /remainingAttempts === 0/);
  assert.match(backend, /source: 'verification_failed_limit'/);
  assert.match(backend, /nextStatus: 'expired'/);
  assert.match(backend, /targetDevicePatch: \{ trusted: false, status: 'new', source: 'verification_failed_limit' \}/);
  assert.match(backend, /await secretRef\.delete\(\)\.catch/);
  assert.match(backend, /requestClosed: true/);
});

test("multi-super-admin race returns the first resolver instead of a false success", () => {
  assert.match(backend, /function buildResolvedApprovalConflictPayload/);
  assert.match(backend, /message = `這筆裝置申請已由 \$\{resolverLabel\} 完成確認`/);
  assert.match(backend, /const resolutionResult = await db\.runTransaction/);
  assert.match(backend, /if \(freshData\.status !== 'pending'\) \{[\s\S]{0,500}conflict: buildResolvedApprovalConflictPayload\(freshData\)/);
  assert.match(backend, /if \(!resolutionResult\?\.applied\) \{/);
  assert.match(backend, /return res\.status\(409\)\.json\(\{[\s\S]{0,450}resolutionResult\?\.conflict/);
  assert.match(backend, /alreadyResolved:\s*true/);
});

test("lost race exits before secret deletion, Telegram side effects, and audit success logging", () => {
  const start = backend.indexOf("const resolutionResult = await db.runTransaction");
  const lostRace = backend.indexOf("if (!resolutionResult?.applied)", start);
  const rejectAlert = backend.indexOf("if (action === 'reject_self')", lostRace);
  const deleteSecret = backend.indexOf("await secretRef.delete().catch", lostRace);
  const successLog = backend.indexOf("await writeSecurityLog({", lostRace);
  const okResponse = backend.indexOf("return res.status(200).json({ ok: true, status: nextStatus })", lostRace);
  assert.ok(start >= 0 && lostRace > start, "Race result must be checked immediately after the transaction.");
  assert.ok(rejectAlert > lostRace, "Self-reject alert must only run for the winning resolver.");
  assert.ok(deleteSecret > lostRace, "Secret deletion must only run for the winning resolver.");
  assert.ok(successLog > lostRace, "Success audit logging must only run for the winning resolver.");
  assert.ok(okResponse > lostRace, "Success response must only be reachable after the winning resolver path.");
});


test("highest-admin action card uses the existing summary instead of an extra pending query", () => {
  const start = app.indexOf("// ★ Highest-admin Security Action Card — Summary-first");
  const end = app.indexOf("// 通知卡顯示期間只監聽「這一筆 request」", start);
  assert.ok(start >= 0 && end > start);
  const block = app.slice(start, end);
  assert.match(block, /deviceApprovalSummary\?\.adminAssistancePendingCount/);
  assert.match(block, /deviceApprovalSummary\?\.adminAssistancePendingItems/);
  assert.doesNotMatch(block, /getDocs\s*\(/);
  assert.doesNotMatch(block, /where\s*\(/);
});

test("device approval summary keeps a manager-assistance queue only for enforce admin-only requests", () => {
  assert.match(backend, /requiresAdminAssistance = securityConfig\.deviceApprovalMode === 'enforce' && !resolvedSelfApprovalAllowed/);
  assert.match(backend, /adminOnly:\s*requiresAdminAssistance/);
  assert.match(backend, /adminAssistancePendingItems/);
  assert.match(backend, /adminAssistancePendingCount = adminItems\.length/);
  assert.match(backend, /latestAdminAssistanceRequestId/);
});

test("manager-assistance summary item is removed whenever its pending request resolves", () => {
  assert.match(backend, /const requestRequiresAdminAssistance = Boolean/);
  assert.match(backend, /removeAdminAssistanceRequestId:\s*requestRequiresAdminAssistance/);
  assert.match(backend, /adminItems = adminItems\.filter/);
});

test("highest-admin card still watches only the displayed request for live resolution", () => {
  assert.match(app, /doc\(getCollectionPath\("device_approval_requests"\), requestId\)/);
  assert.match(app, /return onSnapshot\(requestRef/);
  assert.match(app, /resolvedText:\s*getDeviceApprovalResolvedText\(data\)/);
});

test("summary-first manager notice preserves app version and existing focused approval panel", () => {
  assert.match(app, /CURRENT_APP_VERSION\s*=\s*"3\.5\.3"/);
  assert.match(app, /focusRequestId=\{superAdminApprovalFocusId\}/);
  assert.match(panel, /這是剛才主動提醒您的登入申請/);
});


test("Telegram security config writes are backend-authorized, race-safe, and blocked from direct frontend writes", () => {
  assert.match(functionsIndex, /exports\.updateTelegramSecurityAlertConfig\s*=\s*deviceApprovalFunctions\.updateTelegramSecurityAlertConfig/);
  assert.match(backend, /const updateTelegramSecurityAlertConfig = onRequest/);
  assert.match(backend, /updateTelegramSecurityAlertConfig[\s\S]{0,1400}requireFirebaseRequestAuth\(req, admin\)/);
  assert.match(backend, /updateTelegramSecurityAlertConfig[\s\S]{0,2200}verifySuperAdminActor\(\{ db, brandId, actor \}\)/);
  assert.match(backend, /updateTelegramSecurityAlertConfig[\s\S]{0,3200}db\.runTransaction/);
  assert.match(backend, /expectedRevision !== currentRevision/);
  assert.match(backend, /reason:\s*'revision_conflict'/);
  assert.match(app, /TELEGRAM_SECURITY_CONFIG_ENDPOINT[\s\S]{0,300}updateTelegramSecurityAlertConfig/);
  assert.match(app, /updateTelegramSecurityAlertConfig[\s\S]{0,1300}buildDeviceSecurityActor\(\)/);
  assert.match(telegramCenter, /canManageDeviceSecurity/);
  assert.match(telegramCenter, /currentDeviceTrust\?\.status !== "trusted"/);
  assert.match(telegramCenter, /expectedRevision:\s*securityAlertRevision/);
  assert.doesNotMatch(telegramCenter, /setDoc\(\s*securityConfigRef/);
  assert.match(rules, /match \/artifacts\/\{appId\}\/public\/data\/global_settings\/\{settingId\}/);
  assert.match(rules, /allow write:\s*if signedIn\(\) && settingId != 'telegram_security_alerts'/);
  assert.match(rules, /collectionName != 'global_settings'/);
});

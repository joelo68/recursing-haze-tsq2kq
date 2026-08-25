import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'src', 'App.jsx'), 'utf8');
const panel = fs.readFileSync(path.join(root, 'src', 'components', 'DeviceApprovalPanel.jsx'), 'utf8');
const backend = fs.readFileSync(path.join(root, 'functions', 'deviceApproval.js'), 'utf8');

test('keeps current app version 3.5.3', () => {
  assert.match(app, /CURRENT_APP_VERSION\s*=\s*"3\.5\.3"/);
});

test('highest-admin brand summary remains realtime via the existing onSnapshot', () => {
  assert.match(app, /if \(isDeviceSecuritySuperAdmin\)[\s\S]*onSnapshot\(getSecuritySummaryDocPath\("device_approvals"\)/);
  assert.match(app, /brandPendingCount:\s*Math\.max\(0, Number\(data\.pendingCount \|\| 0\)\)/);
  assert.match(app, /adminAssistancePendingCount:\s*Math\.max\(0, Number\(data\.adminAssistancePendingCount \|\| 0\)\)/);
  assert.match(app, /adminAssistancePendingItems/);
});

test('backend stores manager-assistance queue in the existing device approval summary', () => {
  assert.match(backend, /adminAssistancePendingCount/);
  assert.match(backend, /adminAssistancePendingItems/);
  assert.match(backend, /latestAdminAssistanceRequestId/);
  assert.match(backend, /latestAdminAssistanceUserName/);
  assert.match(backend, /requiresAdminAssistance = securityConfig\.deviceApprovalMode === 'enforce' && !resolvedSelfApprovalAllowed/);
});

test('backend adds only enforce admin-only requests and removes them on resolution', () => {
  assert.match(backend, /adminOnly:\s*requiresAdminAssistance/);
  assert.match(backend, /shouldSyncAdminAssistance/);
  assert.match(backend, /adminAssistanceItem:\s*requiresAdminAssistance \?/);
  assert.match(backend, /const adminAssistancePendingCount = adminItems\.length/);
  assert.match(backend, /requestRequiresAdminAssistance/);
  assert.match(backend, /removeAdminAssistanceRequestId:\s*requestRequiresAdminAssistance/);
});

test('manager action card consumes summary items without an extra pending collection query', () => {
  const start = app.indexOf('// ★ Highest-admin Security Action Card — Summary-first');
  const end = app.indexOf('// 通知卡顯示期間只監聽「這一筆 request」', start);
  assert.ok(start >= 0 && end > start);
  const block = app.slice(start, end);
  assert.match(block, /deviceApprovalSummary\?\.adminAssistancePendingCount/);
  assert.match(block, /deviceApprovalSummary\?\.adminAssistancePendingItems/);
  assert.match(block, /adminItems\.find/);
  assert.doesNotMatch(block, /getDocs\s*\(/);
  assert.doesNotMatch(block, /where\s*\(/);
  assert.doesNotMatch(block, /setInterval\s*\(/);
});

test('manager action card only runs in enforce mode on a trusted highest-admin device', () => {
  const start = app.indexOf('// ★ Highest-admin Security Action Card — Summary-first');
  const end = app.indexOf('// 通知卡顯示期間只監聽「這一筆 request」', start);
  const block = app.slice(start, end);
  assert.match(block, /isDeviceSecuritySuperAdmin/);
  assert.match(block, /securityConfig\?\.deviceApprovalMode === "enforce"/);
  assert.match(block, /currentDeviceTrust\?\.status === "trusted"/);
});

test('same request is auto-notified only once per signed-in brand session', () => {
  assert.match(app, /superAdminNoticeSeenRef\s*=\s*useRef\(new Set\(\)\)/);
  assert.match(app, /superAdminNoticeSeenRef\.current\.has/);
  assert.match(app, /superAdminNoticeSeenRef\.current\.add/);
  assert.match(app, /superAdminNoticeSeenRef\.current = new Set\(\)/);
});

test('dismiss keeps the badge source intact and only closes the notice', () => {
  const fnStart = app.indexOf('const handleDismissSuperAdminDeviceNotice');
  const fnEnd = app.indexOf('// ★ 登入授權名單載入狀態：', fnStart);
  const fn = app.slice(fnStart, fnEnd);
  assert.match(fn, /setSuperAdminDeviceNotice\(null\)/);
  assert.doesNotMatch(fn, /setDeviceApprovalSummary/);
});

test('notice watches only the displayed request live and reports another admin resolver', () => {
  assert.match(app, /doc\(getCollectionPath\("device_approval_requests"\), requestId\)/);
  assert.match(app, /return onSnapshot\(requestRef/);
  assert.match(app, /resolvedBy/);
  assert.match(app, /getDeviceApprovalResolvedText/);
  assert.match(app, /2200/);
});

test('summary count reaching zero does not erase the live resolved message prematurely', () => {
  const start = app.indexOf('// ★ Highest-admin Security Action Card — Summary-first');
  const end = app.indexOf('// 通知卡顯示期間只監聽「這一筆 request」', start);
  const block = app.slice(start, end);
  assert.match(block, /superAdminDeviceNotice\?\.uiStatus === "resolved"/);
  assert.match(block, /!superAdminDeviceNotice &&/);
});

test('notice opens the existing approval panel focused on the alerted request', () => {
  assert.match(app, /setSuperAdminApprovalFocusId\(requestId\)/);
  assert.match(app, /setIsDeviceApprovalPanelOpen\(true\)/);
  assert.match(app, /focusRequestId=\{superAdminApprovalFocusId\}/);
});

test('panel moves the focused request to the top and marks it visibly', () => {
  assert.match(panel, /focusRequestId = ""/);
  assert.match(panel, /aFocused[\s\S]*bFocused/);
  assert.match(panel, /這是剛才主動提醒您的登入申請/);
  assert.match(panel, /ring-2 ring-amber-100/);
});

test('existing guided self-approval still uses its own account-only lookup', () => {
  assert.match(app, /Guided Device Approval/);
  assert.match(app, /where\("accountKey", "==", currentSecurityAccountKey\)/);
  assert.match(app, /request\.selfApprovalAllowed !== false/);
  assert.match(panel, /if \(guided && accountKey\)/);
  assert.match(panel, /if \(row\.selfApprovalAllowed === false\) return false/);
});

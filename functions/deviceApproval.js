const crypto = require('crypto');
const { onRequest } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');

const DEVICE_APPROVAL_DEFAULTS = Object.freeze({
  deviceApprovalMode: 'off',
  deviceApprovalRoles: ['director', 'trainer', 'manager', 'store', 'therapist'],
  deviceApprovalExpiryMinutes: 15,
  allowTrustedDeviceSelfApproval: true,
});

const LEGACY_ALERT_ROLES = new Set(['director', 'trainer', 'manager', 'store']);
const ACTIVE_BLOCK_STATUSES = new Set(['blocked', 'global_blocked', 'manual_global_blocked']);
const DEVICE_APPROVAL_MAX_FAILED_ATTEMPTS = 3;
const LOGIN_SECURITY_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_SECURITY_ALERT_COOLDOWN_MS = 30 * 60 * 1000;
const LOGIN_SECURITY_PASSWORD_FAIL_THRESHOLD = 3;

function sanitizeSecurityKey(value = '') {
  return String(value || '')
    .trim()
    .replace(/[\/.#$\[\]\s]+/g, '_')
    .slice(0, 160) || 'unknown';
}

function normalizeBrandId(value = '') {
  const id = String(value || 'cyj').trim().toLowerCase();
  if (id === 'default-app-id') return 'cyj';
  return ['cyj', 'anniu', 'yibo'].includes(id) ? id : 'cyj';
}

function getBrandLabel(brandId = '') {
  return ({ cyj: 'CYJ', anniu: '安妞', yibo: '伊啵' })[normalizeBrandId(brandId)] || normalizeBrandId(brandId);
}

function getBrandCollection(db, brandId, collectionName) {
  const normalizedBrandId = normalizeBrandId(brandId);
  if (normalizedBrandId === 'cyj') {
    return db.collection(`artifacts/default-app-id/public/data/${collectionName}`);
  }
  return db.collection('brands').doc(normalizedBrandId).collection(collectionName);
}

function getBrandSettingDoc(db, brandId, docName) {
  const normalizedBrandId = normalizeBrandId(brandId);
  if (normalizedBrandId === 'cyj') {
    return db.doc(`artifacts/default-app-id/public/data/global_settings/${docName}`);
  }
  return db.collection('brands').doc(normalizedBrandId).collection('settings').doc(docName);
}

function getBrandSecuritySummaryDoc(db, brandId, docName = 'device_approvals') {
  return getBrandCollection(db, brandId, 'security_summary').doc(docName);
}

function getGlobalBlockedRef(db, roleId, accountId, deviceId) {
  const globalKey = sanitizeSecurityKey(`${roleId}_${accountId}_${deviceId}`);
  return db.doc(`artifacts/default-app-id/public/data/global_blocked_devices/${globalKey}`);
}

function normalizeSecurityConfig(raw = {}) {
  const mode = ['off', 'monitor', 'enforce'].includes(String(raw.deviceApprovalMode || '').trim())
    ? String(raw.deviceApprovalMode).trim()
    : DEVICE_APPROVAL_DEFAULTS.deviceApprovalMode;
  const roles = Array.isArray(raw.deviceApprovalRoles)
    ? [...new Set(raw.deviceApprovalRoles.map(String).filter((role) => DEVICE_APPROVAL_DEFAULTS.deviceApprovalRoles.includes(role)))]
    : DEVICE_APPROVAL_DEFAULTS.deviceApprovalRoles;
  return {
    ...DEVICE_APPROVAL_DEFAULTS,
    ...raw,
    deviceApprovalMode: mode,
    deviceApprovalRoles: roles.length ? roles : DEVICE_APPROVAL_DEFAULTS.deviceApprovalRoles,
    deviceApprovalExpiryMinutes: Math.max(5, Math.min(60, Number(raw.deviceApprovalExpiryMinutes || DEVICE_APPROVAL_DEFAULTS.deviceApprovalExpiryMinutes))),
    allowTrustedDeviceSelfApproval: raw.allowTrustedDeviceSelfApproval !== false,
  };
}

function safePasswordMatch(input = '', expected = '') {
  const a = Buffer.from(String(input || ''));
  const b = Buffer.from(String(expected || ''));
  if (!a.length || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

async function requireFirebaseRequestAuth(req, admin) {
  const authorization = String(req.headers?.authorization || '');
  if (!authorization.startsWith('Bearer ')) return { ok: false };
  const token = authorization.slice('Bearer '.length).trim();
  if (!token) return { ok: false };
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    return { ok: true, uid: String(decoded?.uid || '') };
  } catch (error) {
    return { ok: false };
  }
}

function getDefaultDirectorLevel(name = '') {
  const text = String(name || '');
  if (text.includes('董事長') || text.includes('總經理')) return 'super_admin';
  if (text.includes('財務')) return 'finance_admin';
  return 'operation_admin';
}

function normalizeDirectorAccounts(raw = {}) {
  const sourceAccounts = raw.accounts && typeof raw.accounts === 'object' && Object.keys(raw.accounts).length
    ? raw.accounts
    : (() => {
        const fallback = {};
        Object.entries(raw || {}).forEach(([key, value]) => {
          if (['accounts', 'directorOrder', 'password'].includes(key)) return;
          if (typeof value === 'string') fallback[key] = { id: key, name: key, password: value, isActive: true };
          else if (value && typeof value === 'object') fallback[key] = { id: key, name: key, ...value };
        });
        if (raw.password && !Object.keys(fallback).length) {
          fallback['營運總監'] = { id: '營運總監', name: '營運總監', password: raw.password, isActive: true };
        }
        return fallback;
      })();

  const normalized = {};
  Object.entries(sourceAccounts || {}).forEach(([key, rawAccount]) => {
    const account = typeof rawAccount === 'string' ? { password: rawAccount } : (rawAccount || {});
    const name = String(account.name || key);
    normalized[key] = {
      ...account,
      id: String(account.id || key),
      name,
      password: String(account.password || '0000'),
      level: String(account.level || account.directorLevel || getDefaultDirectorLevel(name || key)),
      isActive: account.isActive !== false,
    };
  });
  return normalized;
}

function normalizeTrainerAccounts(raw = {}) {
  if (raw.accounts && typeof raw.accounts === 'object' && Object.keys(raw.accounts).length) return raw.accounts;
  return {
    trainer_default: {
      id: 'trainer_default',
      name: raw.name || '教專',
      password: raw.password || '0000',
      isActive: raw.isActive !== false,
    },
  };
}

async function verifyApplicationCredential({ db, brandId, roleId, accountId, password }) {
  const role = String(roleId || '').trim();
  const id = String(accountId || '').trim();
  const inputPassword = String(password || '');
  if (!role || !id || !inputPassword) return { ok: false, reason: 'missing_credential' };

  if (role === 'director') {
    const [directorSnap, masterSnap] = await Promise.all([
      getBrandSettingDoc(db, brandId, 'director_auth').get(),
      getBrandSettingDoc(db, brandId, 'master_auth').get(),
    ]);
    const raw = directorSnap.exists ? directorSnap.data() || {} : {};
    const accounts = normalizeDirectorAccounts(raw);
    const account = accounts[id] || Object.values(accounts).find((item) => String(item?.id || item?.name || '') === id);
    if (!account || account.isActive === false) return { ok: false, reason: 'account_inactive_or_missing' };
    const masterPassword = masterSnap.exists ? String(masterSnap.data()?.password || '') : '';
    const isMasterCredential = Boolean(masterPassword && safePasswordMatch(inputPassword, masterPassword));
    const isAccountCredential = safePasswordMatch(inputPassword, account.password || '0000');
    if (!isMasterCredential && !isAccountCredential) return { ok: false, reason: 'wrong_password' };
    return {
      ok: true,
      accountId: String(account.id || id),
      userName: String(account.name || id),
      directorLevel: String(account.level || ''),
      isMasterCredential,
    };
  }

  if (role === 'trainer') {
    const snap = await getBrandSettingDoc(db, brandId, 'trainer_auth').get();
    const raw = snap.exists ? snap.data() || {} : {};
    const accounts = normalizeTrainerAccounts(raw);
    const account = accounts[id] || Object.values(accounts).find((item) => String(item?.id || item?.name || '') === id);
    if (!account || account.isActive === false) return { ok: false, reason: 'account_inactive_or_missing' };
    if (!safePasswordMatch(inputPassword, account.password || '0000')) return { ok: false, reason: 'wrong_password' };
    return { ok: true, accountId: String(account.id || id), userName: String(account.name || id) };
  }

  if (role === 'manager') {
    const snap = await getBrandSettingDoc(db, brandId, 'manager_auth').get();
    const raw = snap.exists ? snap.data() || {} : {};
    const entry = raw[id];
    const expected = typeof entry === 'string' ? entry : String(entry?.password || '');
    if (!expected || !safePasswordMatch(inputPassword, expected)) return { ok: false, reason: 'wrong_password_or_missing' };
    return { ok: true, accountId: id, userName: String(entry?.name || id) };
  }

  if (role === 'store') {
    const snap = await getBrandSettingDoc(db, brandId, 'store_account_data').get();
    const accounts = snap.exists && Array.isArray(snap.data()?.accounts) ? snap.data().accounts : [];
    const account = accounts.find((item) => String(item?.id || '') === id) || accounts.find((item) => String(item?.name || '') === id);
    if (!account || !safePasswordMatch(inputPassword, account.password || '')) return { ok: false, reason: 'wrong_password_or_missing' };
    return { ok: true, accountId: String(account.id || id), userName: String(account.name || id) };
  }

  if (role === 'therapist') {
    const snap = await getBrandCollection(db, brandId, 'therapists').doc(id).get();
    if (!snap.exists) return { ok: false, reason: 'account_missing' };
    const account = snap.data() || {};
    const inactive = account.isActive === false || ['resigned', '離職'].includes(String(account.status || '').toLowerCase()) || account.resigned === true || account.isResigned === true;
    if (inactive) return { ok: false, reason: 'account_inactive' };
    if (!safePasswordMatch(inputPassword, account.password || '')) return { ok: false, reason: 'wrong_password' };
    return { ok: true, accountId: snap.id, userName: String(account.name || id) };
  }

  return { ok: false, reason: 'unsupported_role' };
}

function normalizeLocation(raw = {}) {
  if (!raw || typeof raw !== 'object') return { display: '未知位置', source: 'unknown' };
  return {
    display: String(raw.display || '未知位置'),
    countryCode: String(raw.countryCode || ''),
    countryName: String(raw.countryName || ''),
    region: String(raw.region || ''),
    city: String(raw.city || ''),
    district: String(raw.district || ''),
    timezone: String(raw.timezone || ''),
    isp: String(raw.isp || ''),
    ipMasked: String(raw.ipMasked || ''),
    source: String(raw.source || 'unknown'),
    confidence: String(raw.confidence || 'unknown'),
    isProxy: Boolean(raw.isProxy),
    isMobileNetwork: Boolean(raw.isMobileNetwork),
    updatedAtText: String(raw.updatedAtText || new Date().toISOString()),
  };
}

function normalizeDeviceInfo(raw = {}) {
  const deviceId = sanitizeSecurityKey(raw.deviceId || raw.stableDeviceId || '');
  return {
    deviceId,
    stableDeviceId: deviceId,
    deviceShort: String(raw.deviceShort || deviceId.replace(/^dev_/, '').slice(-8)),
    deviceFingerprint: String(raw.deviceFingerprint || ''),
    deviceStorageStatus: String(raw.deviceStorageStatus || ''),
    device: String(raw.device || '裝置'),
    browser: String(raw.browser || ''),
    os: String(raw.os || ''),
  };
}

function findRecoverableKnownDeviceEntry(devices = {}, deviceInfo = {}, loginLocation = {}) {
  const fingerprint = String(deviceInfo.deviceFingerprint || '');
  if (!fingerprint) return null;
  const city = String(loginLocation.city || loginLocation.region || '').trim();
  let best = null;
  Object.entries(devices || {}).forEach(([storedDeviceId, item]) => {
    if (!item || item.deviceFingerprint !== fingerprint) return;
    if (['observing', 'reverify_required', 'blocked', 'global_blocked', 'suspicious'].includes(String(item.status || ''))) return;
    const previousLocation = item.lastLoginLocation || item.loginLocation || {};
    const previousCity = String(previousLocation.city || previousLocation.region || '').trim();
    const locationCompatible = !city || !previousCity || city === previousCity;
    if (!locationCompatible) return;
    const lastSeenMs = Date.parse(item.lastSeenAtText || item.updatedAtText || '') || 0;
    const score =
      (item.trusted !== false && item.status !== 'new' ? 30 : 0) +
      (Number(item.loginCount || 0) >= 2 ? 20 : 0) +
      10 +
      lastSeenMs / 10000000000000;
    if (!best || score > best.score) best = { storedDeviceId, item, score };
  });
  return best;
}


function isTrustedDeviceRecord(device = {}) {
  if (!device || typeof device !== 'object') return false;
  const status = String(device.status || '');
  const source = String(device.source || '');
  const riskyStatus = ['new', 'observing', 'reverify_required', 'suspicious', 'blocked', 'global_blocked'].includes(status);
  const riskySource = ['manual_observing', 'manual_reverify_required', 'manual_suspicious', 'manual_blocked', 'manual_global_blocked', 'self_reported_not_me'].includes(source);
  return device.trusted !== false && !riskyStatus && !riskySource;
}

function findRecoverableRiskDeviceEntry(devices = {}, deviceInfo = {}, loginLocation = {}) {
  const fingerprint = String(deviceInfo.deviceFingerprint || '');
  if (!fingerprint) return null;
  const city = String(loginLocation.city || loginLocation.region || '').trim();
  let best = null;
  Object.entries(devices || {}).forEach(([storedDeviceId, item]) => {
    if (!item || item.deviceFingerprint !== fingerprint) return;
    const status = String(item.status || '');
    const source = String(item.source || '');
    const isRisky = ['observing', 'reverify_required', 'suspicious', 'blocked', 'global_blocked'].includes(status) ||
      ['manual_observing', 'manual_reverify_required', 'manual_suspicious', 'manual_blocked', 'manual_global_blocked', 'self_reported_not_me'].includes(source);
    if (!isRisky) return;
    const previousLocation = item.lastLoginLocation || item.loginLocation || {};
    const previousCity = String(previousLocation.city || previousLocation.region || '').trim();
    const locationCompatible = !city || !previousCity || city === previousCity;
    if (!locationCompatible) return;
    const lastSeenMs = Date.parse(item.lastSeenAtText || item.updatedAtText || '') || 0;
    const score =
      (['blocked', 'global_blocked'].includes(status) ? 100 : 60) +
      (Number(item.loginCount || 0) >= 2 ? 20 : 0) +
      lastSeenMs / 10000000000000;
    if (!best || score > best.score) best = { storedDeviceId, item, score };
  });
  return best;
}

function makeRequestId(brandId, accountKey, deviceId) {
  return `dar_${crypto.createHash('sha256').update(`${normalizeBrandId(brandId)}|${accountKey}|${deviceId}`).digest('hex').slice(0, 36)}`;
}

function makeVerificationCode() {
  return String(crypto.randomInt(100000, 1000000));
}

function hashVerificationCode(code, salt) {
  return crypto.createHash('sha256').update(`${salt}|${String(code || '')}`).digest('hex');
}

async function writeSecurityLog({ db, brandId, payload }) {
  try {
    await getBrandCollection(db, brandId, 'system_logs').add({
      timestamp: new Date(),
      createdAtText: new Date().toISOString(),
      ...payload,
    });
  } catch (error) {
    console.warn('device approval system log failed', error.message);
  }
}


function getLoginSecurityStateRef(db, brandId, accountKey) {
  return getBrandCollection(db, brandId, 'login_security_state').doc(sanitizeSecurityKey(accountKey));
}

function getLocationComparableParts(raw = {}) {
  const location = normalizeLocation(raw);
  return {
    countryCode: String(location.countryCode || '').trim().toUpperCase(),
    countryName: String(location.countryName || '').trim(),
    area: String(location.city || location.region || '').trim(),
    display: String(location.display || '').trim(),
    source: String(location.source || 'unknown').trim(),
    isMobileNetwork: Boolean(location.isMobileNetwork),
  };
}

function hasMeaningfullyDifferentLoginLocation(previous = {}, current = {}) {
  const a = getLocationComparableParts(previous);
  const b = getLocationComparableParts(current);
  const aKnown = a.source !== 'unknown' && (a.countryCode || a.countryName || a.area);
  const bKnown = b.source !== 'unknown' && (b.countryCode || b.countryName || b.area);
  if (!aKnown || !bKnown) return false;

  const aCountry = a.countryCode || a.countryName;
  const bCountry = b.countryCode || b.countryName;
  if (aCountry && bCountry && aCountry !== bCountry) return true;

  // 行動網路 IP 的城市定位容易漂移；同國城市差異只有在雙方皆非行動網路時才升級警示。
  if (!a.isMobileNetwork && !b.isMobileNetwork && a.area && b.area && a.area !== b.area) return true;
  return false;
}

async function writeTelegramSecurityAlertWithCooldown({
  admin,
  db,
  brandId,
  accountKey,
  alertType,
  severity = 'high',
  cooldownMs = LOGIN_SECURITY_ALERT_COOLDOWN_MS,
  payload = {},
}) {
  const now = Date.now();
  const nowText = new Date(now).toISOString();
  const stateRef = getLoginSecurityStateRef(db, brandId, accountKey);
  const alertRef = getBrandCollection(db, brandId, 'security_alerts').doc();
  const cooldownField = `telegramAlertAtMs_${sanitizeSecurityKey(alertType)}`;
  let created = false;

  await db.runTransaction(async (transaction) => {
    const stateSnap = await transaction.get(stateRef);
    const state = stateSnap.exists ? (stateSnap.data() || {}) : {};
    const lastAlertAtMs = Number(state[cooldownField] || 0);
    if (lastAlertAtMs > 0 && now - lastAlertAtMs < cooldownMs) return;

    transaction.set(stateRef, {
      brandId: normalizeBrandId(brandId),
      accountKey: sanitizeSecurityKey(accountKey),
      [cooldownField]: now,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAtText: nowText,
    }, { merge: true });

    transaction.set(alertRef, {
      category: 'login_security',
      type: alertType,
      telegramSecurityType: alertType,
      notifyTelegram: true,
      telegramDeliveryStatus: 'pending_config',
      severity,
      status: 'unread',
      brandId: normalizeBrandId(brandId),
      brandLabel: getBrandLabel(brandId),
      accountKey: sanitizeSecurityKey(accountKey),
      ...payload,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      createdAtText: nowText,
    }, { merge: false });
    created = true;
  });

  return created;
}

async function recordSuccessfulCredentialLogin({ admin, db, brandId, roleId, accountId, accountKey, userName, deviceInfo, loginLocation, existingDevices = {} }) {
  const now = Date.now();
  const nowText = new Date(now).toISOString();
  const stateRef = getLoginSecurityStateRef(db, brandId, accountKey);

  // 正常成功登入不額外讀取 login_security_state：直接利用 checkDeviceAccess 已讀取的
  // account_devices 歷史判斷短時間異地登入，避免每次登入再增加一筆 Firestore read。
  let previous = null;
  for (const [storedDeviceId, item] of Object.entries(existingDevices || {})) {
    if (!item || storedDeviceId === String(deviceInfo.deviceId || '')) continue;
    const atText = String(item.lastSeenAtText || item.lastLoginAtText || item.updatedAtText || '');
    const atMs = Date.parse(atText);
    if (!Number.isFinite(atMs) || atMs <= 0) continue;
    if (!previous || atMs > previous.atMs) previous = { storedDeviceId, item, atMs, atText };
  }

  await stateRef.set({
    brandId: normalizeBrandId(brandId),
    accountKey: sanitizeSecurityKey(accountKey),
    role: roleId,
    accountId: sanitizeSecurityKey(accountId),
    userName: String(userName || accountId || roleId).slice(0, 120),
    passwordFailedCount: 0,
    passwordWindowStartedAtMs: 0,
    lastSuccessfulLoginAtMs: now,
    lastSuccessfulLoginAtText: nowText,
    lastSuccessfulDeviceId: String(deviceInfo.deviceId || ''),
    lastSuccessfulDeviceShort: String(deviceInfo.deviceShort || ''),
    lastSuccessfulDevice: `${deviceInfo.device || '裝置'} / ${deviceInfo.browser || '-'}`,
    lastSuccessfulLoginLocation: normalizeLocation(loginLocation),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAtText: nowText,
  }, { merge: true });

  if (!previous) return;
  const previousLocation = previous.item?.lastLoginLocation || previous.item?.loginLocation || {};
  const withinWindow = now - previous.atMs <= LOGIN_SECURITY_WINDOW_MS;
  const differentLocation = hasMeaningfullyDifferentLoginLocation(previousLocation, loginLocation);
  if (!withinWindow || !differentLocation) return;

  await writeTelegramSecurityAlertWithCooldown({
    admin,
    db,
    brandId,
    accountKey,
    alertType: 'rapid_multi_location_login',
    severity: 'high',
    payload: {
      role: roleId,
      accountId: sanitizeSecurityKey(accountId),
      userName: String(userName || accountId || roleId).slice(0, 120),
      deviceId: String(deviceInfo.deviceId || ''),
      deviceShort: String(deviceInfo.deviceShort || ''),
      device: String(deviceInfo.device || ''),
      browser: String(deviceInfo.browser || ''),
      os: String(deviceInfo.os || ''),
      loginLocation: normalizeLocation(loginLocation),
      previousDeviceId: previous.storedDeviceId,
      previousDeviceShort: String(previous.item?.deviceShort || ''),
      previousDevice: `${previous.item?.device || '裝置'} / ${previous.item?.browser || '-'}`,
      previousLoginLocation: normalizeLocation(previousLocation),
      previousLoginAtText: previous.atText,
      windowMinutes: Math.round(LOGIN_SECURITY_WINDOW_MS / 60000),
      message: `${userName} 在短時間內由不同裝置、不同地點登入`,
    },
  });
}

async function recordFailedPasswordAttempt({ admin, db, brandId, roleId, accountId, userName, deviceInfo, loginLocation }) {
  const safeAccountId = sanitizeSecurityKey(accountId || 'unknown');
  const accountKey = sanitizeSecurityKey(`${normalizeBrandId(brandId)}_${String(roleId || 'unknown')}_${safeAccountId}`);
  const stateRef = getLoginSecurityStateRef(db, brandId, accountKey);
  const alertRef = getBrandCollection(db, brandId, 'security_alerts').doc();
  const now = Date.now();
  const nowText = new Date(now).toISOString();
  let failedCount = 1;
  let alerted = false;

  await db.runTransaction(async (transaction) => {
    const stateSnap = await transaction.get(stateRef);
    const state = stateSnap.exists ? (stateSnap.data() || {}) : {};
    const windowStartedAtMs = Number(state.passwordWindowStartedAtMs || 0);
    const withinWindow = windowStartedAtMs > 0 && now - windowStartedAtMs <= LOGIN_SECURITY_WINDOW_MS;
    failedCount = withinWindow ? Math.max(0, Number(state.passwordFailedCount || 0)) + 1 : 1;
    const nextWindowStartedAtMs = withinWindow ? windowStartedAtMs : now;
    const lastAlertAtMs = Number(state.telegramAlertAtMs_password_failed_threshold || 0);
    const shouldAlert = failedCount >= LOGIN_SECURITY_PASSWORD_FAIL_THRESHOLD && (now - lastAlertAtMs >= LOGIN_SECURITY_ALERT_COOLDOWN_MS);

    transaction.set(stateRef, {
      brandId: normalizeBrandId(brandId),
      accountKey,
      role: String(roleId || ''),
      accountId: safeAccountId,
      userName: String(userName || accountId || roleId || '使用者').slice(0, 120),
      passwordWindowStartedAtMs: nextWindowStartedAtMs,
      passwordFailedCount: failedCount,
      lastPasswordFailedAtMs: now,
      lastPasswordFailedAtText: nowText,
      lastPasswordFailedDeviceId: String(deviceInfo.deviceId || ''),
      lastPasswordFailedDeviceShort: String(deviceInfo.deviceShort || ''),
      lastPasswordFailedLoginLocation: normalizeLocation(loginLocation),
      ...(shouldAlert ? { telegramAlertAtMs_password_failed_threshold: now } : {}),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAtText: nowText,
    }, { merge: true });

    if (shouldAlert) {
      alerted = true;
      transaction.set(alertRef, {
        category: 'login_security',
        type: 'password_failed_threshold',
        telegramSecurityType: 'password_failed_threshold',
        notifyTelegram: true,
        telegramDeliveryStatus: 'pending_config',
        severity: 'high',
        status: 'unread',
        brandId: normalizeBrandId(brandId),
        brandLabel: getBrandLabel(brandId),
        role: String(roleId || ''),
        accountId: safeAccountId,
        accountKey,
        userName: String(userName || accountId || roleId || '使用者').slice(0, 120),
        deviceId: String(deviceInfo.deviceId || ''),
        deviceShort: String(deviceInfo.deviceShort || ''),
        device: String(deviceInfo.device || ''),
        browser: String(deviceInfo.browser || ''),
        os: String(deviceInfo.os || ''),
        loginLocation: normalizeLocation(loginLocation),
        failedCount,
        windowMinutes: Math.round(LOGIN_SECURITY_WINDOW_MS / 60000),
        message: `${userName || accountId || '使用者'} 在 ${Math.round(LOGIN_SECURITY_WINDOW_MS / 60000)} 分鐘內多次輸入錯誤密碼`,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        createdAtText: nowText,
      }, { merge: false });
    }
  });

  return { accountKey, failedCount, alerted };
}

function adjustPendingSummariesInTransaction({ transaction, db, brandId, accountKey, delta, latest = {}, resolved = {}, inboxSnap, brandSnap }) {
  const inboxRef = getBrandCollection(db, brandId, 'device_approval_inbox').doc(accountKey);
  const brandSummaryRef = getBrandSecuritySummaryDoc(db, brandId, 'device_approvals');
  const inboxCount = Math.max(0, Number(inboxSnap?.data()?.pendingCount || 0) + Number(delta || 0));
  const brandCount = Math.max(0, Number(brandSnap?.data()?.pendingCount || 0) + Number(delta || 0));
  const nowText = new Date().toISOString();
  transaction.set(inboxRef, {
    accountKey,
    pendingCount: inboxCount,
    updatedAtText: nowText,
    ...(Object.keys(latest).length ? latest : {}),
    ...(Object.keys(resolved).length ? resolved : {}),
  }, { merge: true });
  transaction.set(brandSummaryRef, {
    brandId: normalizeBrandId(brandId),
    brandLabel: getBrandLabel(brandId),
    pendingCount: brandCount,
    updatedAtText: nowText,
    ...(Object.keys(latest).length ? latest : {}),
    ...(Object.keys(resolved).length ? resolved : {}),
  }, { merge: true });
}

async function createOrRefreshApprovalRequest({ admin, db, brandId, roleId, accountId, credentialAccountId = '', userName, accountKey, deviceInfo, loginLocation, existingDevice, securityConfig, likelyKnownDevice = false, recoveredFromDeviceId = '', selfApprovalAllowed = false, hasTrustedApproverDevice = false }) {
  const requestId = makeRequestId(brandId, accountKey, deviceInfo.deviceId);
  const requestRef = getBrandCollection(db, brandId, 'device_approval_requests').doc(requestId);
  const secretRef = requestRef.collection('private').doc('verification');
  const profileRef = getBrandCollection(db, brandId, 'account_devices').doc(accountKey);
  const alertRef = getBrandCollection(db, brandId, 'security_alerts').doc();
  const existingStatus = String(existingDevice?.status || '');
  const targetStatus = ['observing', 'reverify_required', 'suspicious'].includes(existingStatus) ? existingStatus : 'new';
  const resolvedSelfApprovalAllowed = Boolean(selfApprovalAllowed) && targetStatus !== 'suspicious' && Boolean(hasTrustedApproverDevice);
  const code = resolvedSelfApprovalAllowed ? makeVerificationCode() : '';
  const salt = resolvedSelfApprovalAllowed ? crypto.randomBytes(16).toString('hex') : '';
  const codeHash = resolvedSelfApprovalAllowed ? hashVerificationCode(code, salt) : '';
  const now = Date.now();
  const nowText = new Date(now).toISOString();
  const expiresAtMs = now + Number(securityConfig.deviceApprovalExpiryMinutes || 15) * 60 * 1000;
  const expiresAtText = new Date(expiresAtMs).toISOString();
  let shouldCreateAlert = false;

  await db.runTransaction(async (transaction) => {
    const inboxRef = getBrandCollection(db, brandId, 'device_approval_inbox').doc(accountKey);
    const brandSummaryRef = getBrandSecuritySummaryDoc(db, brandId, 'device_approvals');
    const [requestSnap, inboxSnap, brandSnap] = await Promise.all([
      transaction.get(requestRef),
      transaction.get(inboxRef),
      transaction.get(brandSummaryRef),
    ]);
    const existingRequest = requestSnap.exists ? requestSnap.data() || {} : {};
    const alreadyPending = existingRequest.status === 'pending';
    shouldCreateAlert = !alreadyPending;

    const nextDevice = {
      ...(existingDevice || {}),
      deviceId: deviceInfo.deviceId,
      stableDeviceId: deviceInfo.deviceId,
      deviceShort: deviceInfo.deviceShort,
      deviceFingerprint: deviceInfo.deviceFingerprint,
      deviceStorageStatus: deviceInfo.deviceStorageStatus,
      device: deviceInfo.device,
      browser: deviceInfo.browser,
      os: deviceInfo.os,
      trusted: false,
      status: targetStatus,
      source: targetStatus === 'suspicious'
        ? (existingDevice?.source || 'manual_suspicious')
        : targetStatus === 'observing'
          ? (existingDevice?.source || 'manual_observing')
          : targetStatus === 'reverify_required'
            ? (existingDevice?.source || 'manual_reverify_required')
            : 'device_approval_pending',
      approvalStatus: 'pending',
      approvalRequestId: requestId,
      firstSeenAt: existingDevice?.firstSeenAt || admin.firestore.FieldValue.serverTimestamp(),
      firstSeenAtText: existingDevice?.firstSeenAtText || nowText,
      lastSeenAt: admin.firestore.FieldValue.serverTimestamp(),
      lastSeenAtText: nowText,
      loginCount: Number(existingDevice?.loginCount || 0) + 1,
      loginLocation,
      firstLoginLocation: existingDevice?.firstLoginLocation || loginLocation,
      lastLoginLocation: loginLocation,
      locationUpdatedAtText: nowText,
      likelyKnownDevice: Boolean(likelyKnownDevice),
      recoveredFromDeviceId: recoveredFromDeviceId || existingDevice?.recoveredFromDeviceId || '',
    };

    transaction.set(profileRef, {
      brandId: normalizeBrandId(brandId),
      brandLabel: getBrandLabel(brandId),
      role: roleId,
      accountId,
      credentialAccountId: credentialAccountId || accountId,
      userName,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAtText: nowText,
      devices: { [deviceInfo.deviceId]: nextDevice },
    }, { merge: true });

    transaction.set(requestRef, {
      schemaVersion: 'device-approval-v1',
      requestId,
      status: 'pending',
      brandId: normalizeBrandId(brandId),
      brandLabel: getBrandLabel(brandId),
      role: roleId,
      accountId,
      credentialAccountId: credentialAccountId || accountId,
      accountKey,
      userName,
      deviceId: deviceInfo.deviceId,
      deviceShort: deviceInfo.deviceShort,
      device: deviceInfo.device,
      browser: deviceInfo.browser,
      os: deviceInfo.os,
      loginLocation,
      likelyKnownDevice: Boolean(likelyKnownDevice),
      recoveredFromDeviceId: recoveredFromDeviceId || '',
      selfApprovalAllowed: resolvedSelfApprovalAllowed,
      hasTrustedApproverDevice: Boolean(hasTrustedApproverDevice),
      deviceStatus: targetStatus,
      requestedAt: admin.firestore.FieldValue.serverTimestamp(),
      requestedAtText: nowText,
      lastAttemptAt: admin.firestore.FieldValue.serverTimestamp(),
      lastAttemptAtText: nowText,
      attemptCount: Number(existingRequest.attemptCount || 0) + 1,
      expiresAtMs,
      expiresAtText,
      approvalMode: securityConfig.deviceApprovalMode,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAtText: nowText,
    }, { merge: true });

    if (resolvedSelfApprovalAllowed) {
      transaction.set(secretRef, {
        codeHash,
        salt,
        failedAttempts: 0,
        expiresAtMs,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAtText: nowText,
      }, { merge: false });
    } else {
      transaction.delete(secretRef);
    }

    if (!alreadyPending) {
      adjustPendingSummariesInTransaction({
        transaction,
        db,
        brandId,
        accountKey,
        delta: 1,
        inboxSnap,
        brandSnap,
        latest: {
          latestRequestId: requestId,
          latestUserName: userName,
          latestRole: roleId,
          latestDevice: `${deviceInfo.device} / ${deviceInfo.browser || '-'}`,
          latestDeviceShort: deviceInfo.deviceShort,
          latestAtText: nowText,
        },
      });
      transaction.set(alertRef, {
        type: 'device_approval_pending',
        severity: roleId === 'director' ? 'high' : 'medium',
        status: 'unread',
        brandId: normalizeBrandId(brandId),
        brandLabel: getBrandLabel(brandId),
        role: roleId,
        accountId,
        accountKey,
        userName,
        requestId,
        deviceId: deviceInfo.deviceId,
        deviceShort: deviceInfo.deviceShort,
        device: deviceInfo.device,
        browser: deviceInfo.browser,
        os: deviceInfo.os,
        loginLocation,
        message: `${userName} 有一台新裝置等待確認`,
        category: 'login_security',
        telegramSecurityType: securityConfig.deviceApprovalMode === 'enforce' && !resolvedSelfApprovalAllowed ? 'manager_assistance_required' : '',
        notifyTelegram: securityConfig.deviceApprovalMode === 'enforce' && !resolvedSelfApprovalAllowed,
        telegramDeliveryStatus: securityConfig.deviceApprovalMode === 'enforce' && !resolvedSelfApprovalAllowed ? 'pending_config' : 'not_required',
        adminOnly: !resolvedSelfApprovalAllowed,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        createdAtText: nowText,
      }, { merge: false });
    }
  });

  return {
    requestId,
    verificationCode: code,
    expiresAtMs,
    expiresAtText,
    shouldCreateAlert,
  };
}

async function resolvePendingRequestInTransaction({ admin, transaction, db, brandId, requestRef, requestData, nextStatus, actorName, actorRole, source, targetDevicePatch = {} }) {
  if (!requestData || requestData.status !== 'pending') return false;
  const accountKey = requestData.accountKey;
  const profileRef = getBrandCollection(db, brandId, 'account_devices').doc(accountKey);
  const inboxRef = getBrandCollection(db, brandId, 'device_approval_inbox').doc(accountKey);
  const brandSummaryRef = getBrandSecuritySummaryDoc(db, brandId, 'device_approvals');
  const [profileSnap, inboxSnap, brandSnap] = await Promise.all([
    transaction.get(profileRef),
    transaction.get(inboxRef),
    transaction.get(brandSummaryRef),
  ]);
  const profile = profileSnap.exists ? profileSnap.data() || {} : {};
  const devices = profile.devices || {};
  const currentDevice = devices[requestData.deviceId] || {};
  const nowText = new Date().toISOString();

  transaction.set(profileRef, {
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAtText: nowText,
    devices: {
      [requestData.deviceId]: {
        ...currentDevice,
        ...targetDevicePatch,
        approvalStatus: nextStatus,
        reviewedBy: actorName,
        reviewedRole: actorRole,
        reviewedAt: admin.firestore.FieldValue.serverTimestamp(),
        reviewedAtText: nowText,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAtText: nowText,
      },
    },
  }, { merge: true });

  transaction.set(requestRef, {
    status: nextStatus,
    resolvedBy: actorName,
    resolvedRole: actorRole,
    resolvedSource: source,
    resolvedAt: admin.firestore.FieldValue.serverTimestamp(),
    resolvedAtText: nowText,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAtText: nowText,
    expiresAtMs: admin.firestore.FieldValue.delete(),
  }, { merge: true });

  adjustPendingSummariesInTransaction({
    transaction,
    db,
    brandId,
    accountKey,
    delta: -1,
    inboxSnap,
    brandSnap,
    resolved: {
      lastResolvedRequestId: requestData.requestId || requestRef.id,
      lastResolvedDeviceShort: requestData.deviceShort || '',
      lastResolvedUserName: requestData.userName || '',
      lastResolvedBy: actorName,
      lastResolvedAtText: nowText,
    },
  });
  return true;
}

async function verifyTrustedApproverDevice({ db, brandId, roleId, accountId, deviceId }) {
  const accountKey = sanitizeSecurityKey(`${normalizeBrandId(brandId)}_${roleId}_${sanitizeSecurityKey(accountId)}`);
  const snap = await getBrandCollection(db, brandId, 'account_devices').doc(accountKey).get();
  const device = snap.exists ? snap.data()?.devices?.[deviceId] : null;
  return isTrustedDeviceRecord(device);
}

async function verifySuperAdminActor({ db, brandId, actor }) {
  if (!actor || String(actor.roleId || '') !== 'director') return { ok: false };
  const accountId = String(actor.accountId || '').trim();
  const deviceId = String(actor.deviceId || '').trim();
  const credentialPassword = String(actor.credentialPassword || '');
  if (!accountId || !deviceId || !credentialPassword) return { ok: false };

  // 先確認操作真的來自此帳號目前已信任的裝置。
  const trusted = await verifyTrustedApproverDevice({ db, brandId, roleId: 'director', accountId, deviceId });
  if (!trusted) return { ok: false };

  // 再重新向後端確認目前登入憑證。避免只靠前端傳來的 accountId / deviceId 判斷管理權限。
  const credential = await verifyApplicationCredential({
    db,
    brandId,
    roleId: 'director',
    accountId,
    password: credentialPassword,
  });
  if (!credential.ok) return { ok: false };
  if (credential.isMasterCredential) {
    return { ok: true, actorName: String(actor.userName || credential.userName || '最高管理者'), actorRole: 'master', actorAccountId: String(credential.accountId || accountId), isMasterCredential: true };
  }
  if (String(credential.directorLevel || '') !== 'super_admin') return { ok: false };
  return { ok: true, actorName: String(credential.userName || actor.userName || accountId), actorRole: 'director', actorAccountId: String(credential.accountId || accountId), isMasterCredential: false };
}

async function verifyMasterPassword({ db, brandId, password }) {
  const snap = await getBrandSettingDoc(db, brandId, 'master_auth').get();
  const expected = snap.exists ? String(snap.data()?.password || '') : '';
  return Boolean(expected && safePasswordMatch(password, expected));
}

function createDeviceApprovalFunctions({ admin, db }) {
  const checkDeviceAccess = onRequest({ cors: true, timeoutSeconds: 20, memory: '256MiB' }, async (req, res) => {
    if (req.method !== 'POST') return res.status(405).json({ ok: false, message: 'method_not_allowed' });
    const requestAuth = await requireFirebaseRequestAuth(req, admin);
    if (!requestAuth.ok) return res.status(401).json({ ok: false, message: '登入狀態已失效，請重新登入' });
    try {
      const body = req.body || {};
      const brandId = normalizeBrandId(body.brandId);
      const roleId = String(body.roleId || '').trim();
      const accountIdInput = String(body.accountId || '').trim();
      const password = String(body.password || '');
      const deviceInfo = normalizeDeviceInfo(body.deviceInfo || {});
      const loginLocation = normalizeLocation(body.loginLocation || {});
      if (!deviceInfo.deviceId) return res.status(400).json({ ok: false, message: 'missing_device' });

      const credential = await verifyApplicationCredential({ db, brandId, roleId, accountId: accountIdInput, password });
      if (!credential.ok) return res.status(401).json({ ok: false, message: '帳號驗證未通過', reason: credential.reason });

      const credentialAccountId = String(credential.accountId || accountIdInput).trim();
      const accountId = sanitizeSecurityKey(credentialAccountId);
      const userName = String(credential.userName || body.userName || credentialAccountId || accountId);
      const accountKey = sanitizeSecurityKey(`${brandId}_${roleId}_${accountId}`);
      const [configSnap, profileSnap] = await Promise.all([
        getBrandSettingDoc(db, brandId, 'security_config').get(),
        getBrandCollection(db, brandId, 'account_devices').doc(accountKey).get(),
      ]);
      const securityConfig = normalizeSecurityConfig(configSnap.exists ? configSnap.data() || {} : {});
      const profile = profileSnap.exists ? profileSnap.data() || {} : {};
      const devices = profile.devices || {};
      await recordSuccessfulCredentialLogin({ admin, db, brandId, roleId, accountId, accountKey, userName, deviceInfo, loginLocation, existingDevices: devices })
        .catch((error) => console.warn('login security observation failed', error.message));
      const exactDevice = devices[deviceInfo.deviceId] || null;
      const recoverableDevice = exactDevice ? null : findRecoverableKnownDeviceEntry(devices, deviceInfo, loginLocation);
      const recoverableRiskDevice = exactDevice ? null : findRecoverableRiskDeviceEntry(devices, deviceInfo, loginLocation);
      const modeApplies = securityConfig.deviceApprovalMode !== 'off' && securityConfig.deviceApprovalRoles.includes(roleId);

      // 舊版 Known Device Recovery 會沿用既有 stable device id；全品牌停用必須同時檢查
      // 「目前瀏覽器產生的 id」與「可辨識到的舊 id」，避免清除瀏覽器資料後繞過既有停用紀錄。
      const globalDeviceIds = [...new Set([
        deviceInfo.deviceId,
        recoverableDevice?.storedDeviceId || '',
        recoverableRiskDevice?.storedDeviceId || '',
      ].filter(Boolean))];
      const globalBlockSnaps = await Promise.all(
        globalDeviceIds.map((candidateDeviceId) => getGlobalBlockedRef(db, roleId, accountId, candidateDeviceId).get())
      );
      const activeGlobalBlockSnap = globalBlockSnaps.find((snap) => {
        if (!snap.exists) return false;
        const block = snap.data() || {};
        return block.active !== false && ACTIVE_BLOCK_STATUSES.has(String(block.status || block.source || ''));
      });
      if (activeGlobalBlockSnap) {
        const block = activeGlobalBlockSnap.data() || {};
        await writeTelegramSecurityAlertWithCooldown({
          admin, db, brandId, accountKey, alertType: 'blocked_device_login', severity: 'high',
          payload: { role: roleId, accountId, userName, deviceId: deviceInfo.deviceId, deviceShort: deviceInfo.deviceShort, device: deviceInfo.device, browser: deviceInfo.browser, os: deviceInfo.os, loginLocation, globalBlocked: true, message: `${userName} 嘗試使用已全品牌停用的裝置登入` },
        }).catch((error) => console.warn('blocked device security alert failed', error.message));
        return res.status(200).json({
          ok: true,
          allowed: false,
          blocked: true,
          globalBlocked: true,
          deviceStatus: 'blocked',
          message: '此裝置目前無法使用系統，請聯繫主管協助。',
          deviceInfo,
          existingDevice: block,
          blockedDeviceId: String(block.deviceId || recoverableRiskDevice?.storedDeviceId || ''),
          loginLocation,
          approvalMode: securityConfig.deviceApprovalMode,
        });
      }

      const blockedDeviceMatch = exactDevice && (
        ['blocked', 'global_blocked'].includes(String(exactDevice.status || '')) ||
        ['manual_blocked', 'manual_global_blocked'].includes(String(exactDevice.source || ''))
      )
        ? { storedDeviceId: deviceInfo.deviceId, item: exactDevice }
        : (recoverableRiskDevice && (
            ['blocked', 'global_blocked'].includes(String(recoverableRiskDevice.item?.status || '')) ||
            ['manual_blocked', 'manual_global_blocked'].includes(String(recoverableRiskDevice.item?.source || ''))
          ) ? recoverableRiskDevice : null);

      if (blockedDeviceMatch) {
        const blockedDevice = blockedDeviceMatch.item || {};
        await writeTelegramSecurityAlertWithCooldown({
          admin, db, brandId, accountKey, alertType: 'blocked_device_login', severity: 'high',
          payload: { role: roleId, accountId, userName, deviceId: deviceInfo.deviceId, deviceShort: deviceInfo.deviceShort, device: deviceInfo.device, browser: deviceInfo.browser, os: deviceInfo.os, loginLocation, globalBlocked: blockedDevice?.status === 'global_blocked' || blockedDevice?.source === 'manual_global_blocked', message: `${userName} 嘗試使用已停用的裝置登入` },
        }).catch((error) => console.warn('blocked device security alert failed', error.message));
        return res.status(200).json({
          ok: true,
          allowed: false,
          blocked: true,
          globalBlocked: blockedDevice?.status === 'global_blocked' || blockedDevice?.source === 'manual_global_blocked',
          deviceStatus: 'blocked',
          message: '此裝置目前無法使用系統，請聯繫主管協助。',
          deviceInfo,
          existingDevice: blockedDevice,
          blockedDeviceId: blockedDeviceMatch.storedDeviceId || deviceInfo.deviceId,
          loginLocation,
          approvalMode: securityConfig.deviceApprovalMode,
        });
      }

      const exactDeviceIsTrusted = isTrustedDeviceRecord(exactDevice);
      if (exactDeviceIsTrusted) {
        const nowText = new Date().toISOString();
        await getBrandCollection(db, brandId, 'account_devices').doc(accountKey).set({
          brandId,
          brandLabel: getBrandLabel(brandId),
          role: roleId,
          accountId,
          credentialAccountId,
          userName,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAtText: nowText,
          devices: {
            [deviceInfo.deviceId]: {
              ...exactDevice,
              device: deviceInfo.device,
              browser: deviceInfo.browser,
              os: deviceInfo.os,
              deviceFingerprint: deviceInfo.deviceFingerprint,
              deviceStorageStatus: deviceInfo.deviceStorageStatus,
              lastSeenAt: admin.firestore.FieldValue.serverTimestamp(),
              lastSeenAtText: nowText,
              loginCount: Number(exactDevice.loginCount || 0) + 1,
              loginLocation,
              lastLoginLocation: loginLocation,
              locationUpdatedAtText: nowText,
            },
          },
        }, { merge: true });
        return res.status(200).json({
          ok: true,
          allowed: true,
          deviceTrusted: true,
          deviceStatus: 'trusted',
          isNewDevice: false,
          deviceInfo,
          loginLocation,
          approvalMode: securityConfig.deviceApprovalMode,
        });
      }

      // 觀察模式下，最高管理者已分類的裝置不反覆建立確認碼申請。
      // observing = 繼續觀察；reverify_required = 已要求重新驗證，但等正式驗證模式啟用後才阻擋登入。
      const exactReviewStatus = String(exactDevice?.status || '');
      if (modeApplies && securityConfig.deviceApprovalMode === 'monitor' && ['observing', 'reverify_required'].includes(exactReviewStatus)) {
        const nowText = new Date().toISOString();
        const reviewedDevice = {
          ...exactDevice,
          device: deviceInfo.device,
          browser: deviceInfo.browser,
          os: deviceInfo.os,
          deviceFingerprint: deviceInfo.deviceFingerprint,
          deviceStorageStatus: deviceInfo.deviceStorageStatus,
          trusted: false,
          status: exactReviewStatus,
          lastSeenAt: admin.firestore.FieldValue.serverTimestamp(),
          lastSeenAtText: nowText,
          loginCount: Number(exactDevice.loginCount || 0) + 1,
          loginLocation,
          lastLoginLocation: loginLocation,
          locationUpdatedAtText: nowText,
          updatedAtText: nowText,
        };
        await getBrandCollection(db, brandId, 'account_devices').doc(accountKey).set({
          brandId,
          brandLabel: getBrandLabel(brandId),
          role: roleId,
          accountId,
          credentialAccountId,
          userName,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAtText: nowText,
          devices: { [deviceInfo.deviceId]: reviewedDevice },
        }, { merge: true });
        return res.status(200).json({
          ok: true,
          allowed: true,
          approvalRequired: false,
          deviceTrusted: false,
          deviceStatus: exactReviewStatus,
          reverifyRequired: exactReviewStatus === 'reverify_required',
          isNewDevice: false,
          deviceInfo,
          loginLocation,
          approvalMode: securityConfig.deviceApprovalMode,
          message: exactReviewStatus === 'reverify_required'
            ? '主管已要求這台裝置重新驗證；目前為觀察階段，仍可繼續使用。'
            : '這台裝置目前維持觀察狀態，仍可繼續使用。',
        });
      }

      if (!modeApplies) {
        const recovered = recoverableDevice;
        const effectiveDeviceId = recovered?.storedDeviceId || deviceInfo.deviceId;
        const existingDevice = exactDevice || recovered?.item || null;
        const effectiveInfo = { ...deviceInfo, deviceId: effectiveDeviceId, stableDeviceId: effectiveDeviceId, deviceShort: String(effectiveDeviceId).replace(/^dev_/, '').slice(-8) };
        if (existingDevice) {
          const nowText = new Date().toISOString();
          await getBrandCollection(db, brandId, 'account_devices').doc(accountKey).set({
            brandId,
            brandLabel: getBrandLabel(brandId),
            role: roleId,
            accountId,
            credentialAccountId,
            userName,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAtText: nowText,
            devices: {
              [effectiveDeviceId]: {
                ...existingDevice,
                deviceId: effectiveDeviceId,
                stableDeviceId: effectiveDeviceId,
                deviceShort: effectiveInfo.deviceShort,
                device: deviceInfo.device,
                browser: deviceInfo.browser,
                os: deviceInfo.os,
                deviceFingerprint: deviceInfo.deviceFingerprint,
                deviceStorageStatus: deviceInfo.deviceStorageStatus,
                recoveredKnownDevice: Boolean(recovered),
                recoveredFromDeviceIds: recovered ? Array.from(new Set([...(existingDevice.recoveredFromDeviceIds || []), deviceInfo.deviceId])) : (existingDevice.recoveredFromDeviceIds || []),
                lastSeenAt: admin.firestore.FieldValue.serverTimestamp(),
                lastSeenAtText: nowText,
                loginCount: Number(existingDevice.loginCount || 0) + 1,
                loginLocation,
                lastLoginLocation: loginLocation,
                locationUpdatedAtText: nowText,
              },
            },
          }, { merge: true });
          return res.status(200).json({
            ok: true,
            allowed: true,
            deviceTrusted: existingDevice.trusted !== false,
            deviceStatus: existingDevice.status || (existingDevice.trusted === false ? 'new' : 'trusted'),
            isNewDevice: false,
            recoveredKnownDevice: Boolean(recovered),
            recoveredDeviceId: recovered?.storedDeviceId || '',
            originalDeviceId: deviceInfo.deviceId,
            deviceInfo: effectiveInfo,
            loginLocation,
            approvalMode: securityConfig.deviceApprovalMode,
          });
        }

        const trustedCount = Object.values(devices).filter((item) => isTrustedDeviceRecord(item)).length;
        const autoTrusted = trustedCount < 2;
        const shouldAlert = !autoTrusted && LEGACY_ALERT_ROLES.has(roleId);
        const nowText = new Date().toISOString();
        const newDevice = {
          ...deviceInfo,
          trusted: autoTrusted,
          status: autoTrusted ? 'trusted' : 'new',
          source: autoTrusted ? 'auto_trust_first_two_devices' : 'new_device_detected',
          firstSeenAt: admin.firestore.FieldValue.serverTimestamp(),
          firstSeenAtText: nowText,
          lastSeenAt: admin.firestore.FieldValue.serverTimestamp(),
          lastSeenAtText: nowText,
          loginCount: 1,
          loginLocation,
          firstLoginLocation: loginLocation,
          lastLoginLocation: loginLocation,
          locationUpdatedAtText: nowText,
        };
        await getBrandCollection(db, brandId, 'account_devices').doc(accountKey).set({
          brandId,
          brandLabel: getBrandLabel(brandId),
          role: roleId,
          accountId,
          credentialAccountId,
          userName,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAtText: nowText,
          devices: { [deviceInfo.deviceId]: newDevice },
        }, { merge: true });
        if (shouldAlert) {
          await Promise.all([
            getBrandCollection(db, brandId, 'security_alerts').add({
              type: 'new_device_login', severity: roleId === 'director' ? 'high' : 'medium', status: 'unread', brandId, brandLabel: getBrandLabel(brandId), role: roleId, accountId, userName,
              deviceId: deviceInfo.deviceId, deviceShort: deviceInfo.deviceShort, device: deviceInfo.device, browser: deviceInfo.browser, os: deviceInfo.os, loginLocation,
              trustedDeviceCountBefore: trustedCount, message: `${userName} 出現新裝置登入`, createdAt: admin.firestore.FieldValue.serverTimestamp(), createdAtText: nowText,
            }),
            getBrandSecuritySummaryDoc(db, brandId, 'device_alerts').set({
              pendingNewDeviceCount: admin.firestore.FieldValue.increment(1), latestUserName: userName, latestRole: roleId,
              latestDevice: `${deviceInfo.device} / ${deviceInfo.browser || '-'}`, latestDeviceShort: deviceInfo.deviceShort,
              latestAt: admin.firestore.FieldValue.serverTimestamp(), latestAtText: nowText,
              updatedAt: admin.firestore.FieldValue.serverTimestamp(), updatedAtText: nowText,
              brandId, brandLabel: getBrandLabel(brandId),
            }, { merge: true }),
          ]);
        }
        return res.status(200).json({
          ok: true,
          allowed: true,
          isNewDevice: true,
          deviceTrusted: autoTrusted,
          autoTrusted,
          deviceStatus: autoTrusted ? 'trusted' : 'new',
          deviceInfo,
          loginLocation,
          approvalMode: securityConfig.deviceApprovalMode,
        });
      }

      const recovered = recoverableDevice;
      const reviewRecovered = recoverableRiskDevice && (
        ['observing', 'reverify_required', 'suspicious'].includes(String(recoverableRiskDevice.item?.status || '')) ||
        ['manual_observing', 'manual_reverify_required', 'manual_suspicious', 'self_reported_not_me'].includes(String(recoverableRiskDevice.item?.source || ''))
      ) ? recoverableRiskDevice : null;
      const approvalExistingDevice = exactDevice || reviewRecovered?.item || null;
      const approvalRecoveredDeviceId = reviewRecovered?.storedDeviceId || recovered?.storedDeviceId || '';
      const excludedApproverIds = new Set([deviceInfo.deviceId, approvalRecoveredDeviceId].filter(Boolean));
      const hasTrustedApproverDevice = Object.entries(devices || {}).some(([storedDeviceId, item]) => (
        !excludedApproverIds.has(storedDeviceId) && isTrustedDeviceRecord(item)
      ));
      const selfApprovalAllowed = Boolean(securityConfig.allowTrustedDeviceSelfApproval) &&
        approvalExistingDevice?.status !== 'suspicious' &&
        hasTrustedApproverDevice;

      const request = await createOrRefreshApprovalRequest({
        admin,
        db,
        brandId,
        roleId,
        accountId,
        credentialAccountId,
        userName,
        accountKey,
        deviceInfo,
        loginLocation,
        existingDevice: approvalExistingDevice,
        securityConfig,
        likelyKnownDevice: Boolean(recovered || reviewRecovered),
        recoveredFromDeviceId: approvalRecoveredDeviceId,
        selfApprovalAllowed,
        hasTrustedApproverDevice,
      });
      const enforced = securityConfig.deviceApprovalMode === 'enforce';
      await writeSecurityLog({
        db,
        brandId,
        payload: {
          role: roleId,
          user: userName,
          action: enforced ? '新裝置等待確認' : '新裝置觀察中',
          activityType: enforced ? 'auth.device_approval_pending' : 'security.device_monitor_pending',
          view: 'login',
          device: deviceInfo.device,
          browser: deviceInfo.browser,
          os: deviceInfo.os,
          deviceId: deviceInfo.deviceId,
          deviceShort: deviceInfo.deviceShort,
          details: { requestId: request.requestId, likelyKnownDevice: Boolean(recovered || reviewRecovered), approvalMode: securityConfig.deviceApprovalMode },
        },
      });
      return res.status(200).json({
        ok: true,
        allowed: !enforced,
        approvalRequired: true,
        approvalMode: securityConfig.deviceApprovalMode,
        requestId: request.requestId,
        verificationCode: selfApprovalAllowed ? request.verificationCode : '',
        expiresAtMs: request.expiresAtMs,
        expiresAtText: request.expiresAtText,
        selfApprovalAllowed,
        hasTrustedApproverDevice,
        adminOnly: !selfApprovalAllowed,
        deviceTrusted: false,
        deviceStatus: ['observing', 'reverify_required', 'suspicious'].includes(String(approvalExistingDevice?.status || '')) ? String(approvalExistingDevice.status) : 'new',
        isNewDevice: !exactDevice,
        likelyKnownDevice: Boolean(recovered || reviewRecovered),
        recoveredFromDeviceId: approvalRecoveredDeviceId,
        deviceInfo,
        loginLocation,
        message: enforced ? '這台裝置需要先完成確認，才能進入系統。' : '已記錄這台新裝置，目前仍可繼續使用。',
      });
    } catch (error) {
      console.error('checkDeviceAccess failed', error);
      return res.status(500).json({ ok: false, message: '裝置確認暫時無法完成，請稍後再試。' });
    }
  });

  const reviewDeviceApproval = onRequest({ cors: true, timeoutSeconds: 20, memory: '256MiB' }, async (req, res) => {
    if (req.method !== 'POST') return res.status(405).json({ ok: false, message: 'method_not_allowed' });
    const requestAuth = await requireFirebaseRequestAuth(req, admin);
    if (!requestAuth.ok) return res.status(401).json({ ok: false, message: '登入狀態已失效，請重新登入' });
    try {
      const body = req.body || {};
      const brandId = normalizeBrandId(body.brandId);
      const requestId = String(body.requestId || '').trim();
      const action = String(body.action || '').trim();
      const actor = body.actor || {};
      if (!requestId || !action) return res.status(400).json({ ok: false, message: '資料不完整' });
      const requestRef = getBrandCollection(db, brandId, 'device_approval_requests').doc(requestId);
      const secretRef = requestRef.collection('private').doc('verification');
      const requestSnap = await requestRef.get();
      if (!requestSnap.exists) return res.status(404).json({ ok: false, message: '找不到這筆裝置確認申請' });
      const requestData = requestSnap.data() || {};
      if (requestData.status !== 'pending') return res.status(409).json({ ok: false, message: '這筆申請已經處理完成', status: requestData.status });
      if (Number(requestData.expiresAtMs || 0) > 0 && Date.now() > Number(requestData.expiresAtMs || 0)) {
        return res.status(410).json({ ok: false, message: '確認時間已過，請讓新裝置重新登入申請' });
      }

      let actorName = String(actor.userName || '使用者');
      let actorRole = String(actor.roleId || '');
      let source = 'unknown';

      if (['approve_self', 'reject_self'].includes(action)) {
        if (String(actor.accountKey || '') !== String(requestData.accountKey || '')) return res.status(403).json({ ok: false, message: '只能確認自己的裝置' });
        if (String(actor.deviceId || '') === String(requestData.deviceId || '')) return res.status(403).json({ ok: false, message: '請改用原本已信任的裝置完成確認' });
        const trusted = await verifyTrustedApproverDevice({ db, brandId, roleId: requestData.role, accountId: requestData.accountId, deviceId: String(actor.deviceId || '') });
        if (!trusted) return res.status(403).json({ ok: false, message: '目前這台裝置尚未完成信任確認' });
        const actorCredential = await verifyApplicationCredential({
          db,
          brandId,
          roleId: requestData.role,
          accountId: requestData.credentialAccountId || requestData.accountId,
          password: String(actor.credentialPassword || ''),
        });
        if (!actorCredential.ok) return res.status(403).json({ ok: false, message: '目前登入狀態需要重新確認，請重新登入後再試' });
        actorName = requestData.userName || actorCredential.userName || actorName;
        actorRole = requestData.role || actorRole;
        source = action === 'approve_self' ? 'trusted_device_self_approval' : 'trusted_device_self_reject';

        if (action === 'approve_self') {
          if (requestData.selfApprovalAllowed === false) return res.status(403).json({ ok: false, message: '這筆申請需要由最高管理者協助確認' });
          const code = String(body.verificationCode || '').trim();
          const secretSnap = await secretRef.get();
          const secret = secretSnap.exists ? secretSnap.data() || {} : {};
          if (!secret.codeHash || !secret.salt) return res.status(410).json({ ok: false, message: '確認碼已失效，請重新登入申請' });
          if (Date.now() > Number(secret.expiresAtMs || 0)) return res.status(410).json({ ok: false, message: '確認時間已過，請重新登入申請' });
          const failedAttempts = Math.max(0, Number(secret.failedAttempts || 0));
          if (failedAttempts >= DEVICE_APPROVAL_MAX_FAILED_ATTEMPTS) {
            return res.status(429).json({
              ok: false,
              message: `確認碼輸入次數已達 ${DEVICE_APPROVAL_MAX_FAILED_ATTEMPTS} 次上限。還可嘗試 0 次，請讓新裝置重新登入申請。`,
              remainingAttempts: 0,
              maxAttempts: DEVICE_APPROVAL_MAX_FAILED_ATTEMPTS,
            });
          }
          const matched = safePasswordMatch(hashVerificationCode(code, secret.salt), secret.codeHash);
          if (!matched) {
            const nextFailedAttempts = failedAttempts + 1;
            const remainingAttempts = Math.max(0, DEVICE_APPROVAL_MAX_FAILED_ATTEMPTS - nextFailedAttempts);
            await secretRef.set({ failedAttempts: admin.firestore.FieldValue.increment(1), updatedAtText: new Date().toISOString() }, { merge: true });
            if (remainingAttempts === 0) {
              await writeTelegramSecurityAlertWithCooldown({
                admin, db, brandId, accountKey: requestData.accountKey, alertType: 'device_code_failed_limit', severity: 'high',
                payload: { role: requestData.role || actorRole, accountId: requestData.accountId || '', userName: requestData.userName || actorName, requestId, deviceId: requestData.deviceId || '', deviceShort: requestData.deviceShort || '', device: requestData.device || '', browser: requestData.browser || '', os: requestData.os || '', loginLocation: normalizeLocation(requestData.loginLocation || {}), failedCount: DEVICE_APPROVAL_MAX_FAILED_ATTEMPTS, message: `${requestData.userName || actorName} 的 6 位裝置確認碼已連續錯誤 ${DEVICE_APPROVAL_MAX_FAILED_ATTEMPTS} 次` },
              }).catch((error) => console.warn('verification failure security alert failed', error.message));

              // Guided flow 不能讓真正的舊信任裝置因一筆已失效的驗證申請被卡住。
              // 第 3 次錯誤時直接結束這筆 pending request；新裝置仍被擋在登入外，
              // 並必須重新登入取得新的 6 位碼。這也會同步把 Header pendingCount 減 1。
              await db.runTransaction(async (transaction) => {
                const freshSnap = await transaction.get(requestRef);
                if (!freshSnap.exists || freshSnap.data()?.status !== 'pending') return;
                await resolvePendingRequestInTransaction({
                  admin,
                  transaction,
                  db,
                  brandId,
                  requestRef,
                  requestData: freshSnap.data() || {},
                  nextStatus: 'expired',
                  actorName: '系統',
                  actorRole: 'system',
                  source: 'verification_failed_limit',
                  targetDevicePatch: { trusted: false, status: 'new', source: 'verification_failed_limit' },
                });
              });
              await secretRef.delete().catch(() => {});

              return res.status(429).json({
                ok: false,
                message: `確認碼不正確，已達 ${DEVICE_APPROVAL_MAX_FAILED_ATTEMPTS} 次上限。還可嘗試 0 次，請讓新裝置重新登入申請。`,
                remainingAttempts,
                maxAttempts: DEVICE_APPROVAL_MAX_FAILED_ATTEMPTS,
                requestClosed: true,
              });
            }
            return res.status(400).json({
              ok: false,
              message: `確認碼不正確，請重新確認。還可嘗試 ${remainingAttempts} 次。`,
              remainingAttempts,
              maxAttempts: DEVICE_APPROVAL_MAX_FAILED_ATTEMPTS,
            });
          }
        }
      } else {
        const adminCheck = await verifySuperAdminActor({ db, brandId, actor });
        if (!adminCheck.ok) return res.status(403).json({ ok: false, message: '此操作僅限最高管理者使用' });
        actorName = adminCheck.actorName;
        actorRole = adminCheck.actorRole;

        // 最高管理者處理「自己的」新裝置時，只要這筆申請允許由既有信任裝置自助確認，
        // 就不得透過 approve_admin 繞過 6 位確認碼。這項限制必須放在後端，不能只靠前端隱藏按鈕。
        const actorOwnsRequest =
          String(requestData.role || '') === 'director' &&
          sanitizeSecurityKey(adminCheck.actorAccountId || '') === sanitizeSecurityKey(requestData.accountId || '');
        if (action === 'approve_admin' && actorOwnsRequest && requestData.selfApprovalAllowed !== false) {
          return res.status(409).json({ ok: false, message: '自己的新裝置請使用原本已信任的裝置輸入 6 位確認碼完成驗證' });
        }

        source = 'super_admin_review';
      }

      let targetDevicePatch;
      let nextStatus;
      if (action === 'approve_self' || action === 'approve_admin') {
        nextStatus = 'approved';
        targetDevicePatch = { trusted: true, status: 'trusted', source: action === 'approve_self' ? 'trusted_device_approved' : 'admin_approved' };
      } else if (action === 'reject_self') {
        nextStatus = 'rejected';
        targetDevicePatch = { trusted: false, status: 'suspicious', source: 'self_reported_not_me' };
      } else if (action === 'observe_admin' || action === 'reject_admin') {
        nextStatus = 'observing';
        targetDevicePatch = { trusted: false, status: 'observing', source: 'manual_observing' };
      } else if (action === 'reverify_admin' || action === 'suspicious_admin') {
        nextStatus = 'reverify_required';
        targetDevicePatch = { trusted: false, status: 'reverify_required', source: 'manual_reverify_required', reverifyRequired: true };
      } else if (action === 'block_admin') {
        nextStatus = 'blocked';
        targetDevicePatch = { trusted: false, status: 'blocked', source: 'manual_blocked', blockedBy: actorName, blockedAtText: new Date().toISOString(), blockScope: 'current_brand' };
      } else {
        return res.status(400).json({ ok: false, message: '不支援的處理方式' });
      }

      await db.runTransaction(async (transaction) => {
        const freshSnap = await transaction.get(requestRef);
        if (!freshSnap.exists || freshSnap.data()?.status !== 'pending') return;
        await resolvePendingRequestInTransaction({ admin, transaction, db, brandId, requestRef, requestData: freshSnap.data() || {}, nextStatus, actorName, actorRole, source, targetDevicePatch });
      });
      if (action === 'reject_self') {
        await writeTelegramSecurityAlertWithCooldown({
          admin, db, brandId, accountKey: requestData.accountKey, alertType: 'self_reported_not_me', severity: 'critical', cooldownMs: 5 * 60 * 1000,
          payload: { role: requestData.role || actorRole, accountId: requestData.accountId || '', userName: requestData.userName || actorName, requestId, deviceId: requestData.deviceId || '', deviceShort: requestData.deviceShort || '', device: requestData.device || '', browser: requestData.browser || '', os: requestData.os || '', loginLocation: normalizeLocation(requestData.loginLocation || {}), message: `${requestData.userName || actorName} 回報這台登入裝置不是本人使用` },
        }).catch((error) => console.warn('self reject security alert failed', error.message));
      }
      await secretRef.delete().catch(() => {});
      await writeSecurityLog({
        db,
        brandId,
        payload: {
          role: actorRole,
          user: actorName,
          action: nextStatus === 'approved'
            ? '允許新裝置使用'
            : nextStatus === 'observing'
              ? '新裝置繼續觀察'
              : nextStatus === 'reverify_required'
                ? '要求新裝置重新驗證'
                : nextStatus === 'blocked'
                  ? '禁止新裝置使用'
                  : '處理新裝置申請',
          activityType: nextStatus === 'approved' ? 'security.device_approved' : 'security.device_reviewed',
          view: 'device-approval',
          device: requestData.device,
          browser: requestData.browser,
          os: requestData.os,
          deviceId: requestData.deviceId,
          deviceShort: requestData.deviceShort,
          details: { requestId, targetUserName: requestData.userName, action, source },
        },
      });
      return res.status(200).json({ ok: true, status: nextStatus });
    } catch (error) {
      console.error('reviewDeviceApproval failed', error);
      return res.status(500).json({ ok: false, message: '目前無法完成裝置確認，請稍後再試。' });
    }
  });

  const reportLoginSecurityEvent = onRequest({ cors: true, timeoutSeconds: 15, memory: '256MiB' }, async (req, res) => {
    if (req.method !== 'POST') return res.status(405).json({ ok: false, message: 'method_not_allowed' });
    const requestAuth = await requireFirebaseRequestAuth(req, admin);
    if (!requestAuth.ok) return res.status(401).json({ ok: false, message: '登入狀態已失效，請重新整理後再試' });
    try {
      const body = req.body || {};
      const eventType = String(body.eventType || '').trim();
      if (eventType !== 'password_failed') return res.status(400).json({ ok: false, message: 'unsupported_security_event' });
      const brandId = normalizeBrandId(body.brandId);
      const roleId = String(body.roleId || '').trim();
      const accountId = String(body.accountId || '').trim();
      const userName = String(body.userName || accountId || roleId || '使用者').trim().slice(0, 120);
      const deviceInfo = normalizeDeviceInfo(body.deviceInfo || {});
      const loginLocation = normalizeLocation(body.loginLocation || {});
      if (!roleId || !accountId || !deviceInfo.deviceId) return res.status(400).json({ ok: false, message: 'missing_security_event_fields' });
      const result = await recordFailedPasswordAttempt({ admin, db, brandId, roleId, accountId, userName, deviceInfo, loginLocation });
      return res.status(200).json({ ok: true, eventType, failedCount: result.failedCount, alerted: result.alerted });
    } catch (error) {
      console.error('reportLoginSecurityEvent failed', error);
      return res.status(500).json({ ok: false, message: '登入安全事件暫時無法記錄' });
    }
  });

  const manageAccountDevice = onRequest({ cors: true, timeoutSeconds: 20, memory: '256MiB' }, async (req, res) => {
    if (req.method !== 'POST') return res.status(405).json({ ok: false, message: 'method_not_allowed' });
    const requestAuth = await requireFirebaseRequestAuth(req, admin);
    if (!requestAuth.ok) return res.status(401).json({ ok: false, message: '登入狀態已失效，請重新登入' });
    try {
      const body = req.body || {};
      const brandId = normalizeBrandId(body.brandId);
      const accountKey = String(body.accountKey || '').trim();
      const deviceId = String(body.deviceId || '').trim();
      const nextStatus = String(body.nextStatus || '').trim();
      const actor = body.actor || {};
      if (!accountKey || !deviceId || !['trusted', 'observing', 'reverify_required', 'suspicious', 'blocked', 'global_blocked'].includes(nextStatus)) {
        return res.status(400).json({ ok: false, message: '資料不完整' });
      }
      const adminCheck = await verifySuperAdminActor({ db, brandId, actor });
      if (!adminCheck.ok) return res.status(403).json({ ok: false, message: '此操作僅限最高管理者使用' });
      const profileRef = getBrandCollection(db, brandId, 'account_devices').doc(accountKey);
      const profileSnap = await profileRef.get();
      if (!profileSnap.exists) return res.status(404).json({ ok: false, message: '找不到裝置資料' });
      const profile = profileSnap.data() || {};
      const device = profile.devices?.[deviceId];
      if (!device) return res.status(404).json({ ok: false, message: '找不到這台裝置' });
      const actorName = adminCheck.actorName;
      const nowText = new Date().toISOString();
      const isTrusted = nextStatus === 'trusted';
      const isGlobalBlocked = nextStatus === 'global_blocked';
      const isBlocked = nextStatus === 'blocked' || isGlobalBlocked;
      const isObserving = nextStatus === 'observing';
      const isReverifyRequired = nextStatus === 'reverify_required' || nextStatus === 'suspicious';
      const nextDevice = {
        ...device,
        trusted: isTrusted,
        status: nextStatus === 'suspicious' ? 'reverify_required' : nextStatus,
        source: isTrusted
          ? 'manual_trusted'
          : isGlobalBlocked
            ? 'manual_global_blocked'
            : isBlocked
              ? 'manual_blocked'
              : isObserving
                ? 'manual_observing'
                : 'manual_reverify_required',
        ...(isReverifyRequired ? { reverifyRequired: true } : { reverifyRequired: false }),
        reviewedBy: actorName,
        reviewedRole: 'director',
        reviewedAtText: nowText,
        updatedAtText: nowText,
        ...(isBlocked ? { blockedBy: actorName, blockedAtText: nowText, blockScope: isGlobalBlocked ? 'all_brands' : 'current_brand' } : {}),
      };
      await profileRef.set({ devices: { [deviceId]: nextDevice }, updatedAtText: nowText }, { merge: true });

      const globalRef = getGlobalBlockedRef(db, profile.role || 'unknown', profile.accountId || profile.userName || accountKey, deviceId);
      if (isGlobalBlocked) {
        await globalRef.set({
          active: true, status: 'global_blocked', source: 'manual_global_blocked', scope: 'all_brands', role: profile.role || '', accountId: profile.accountId || '',
          userName: profile.userName || profile.accountId || accountKey, deviceId, deviceShort: device.deviceShort || '', device: device.device || '', browser: device.browser || '', os: device.os || '',
          blockedBy: actorName, blockedRole: 'director', blockedAtText: nowText, updatedAtText: nowText,
        }, { merge: true });
      } else if (isTrusted) {
        await globalRef.set({ active: false, status: 'resolved', source: 'manual_trusted', resolvedBy: actorName, resolvedRole: 'director', resolvedAtText: nowText, updatedAtText: nowText }, { merge: true });
      }

      const requestId = makeRequestId(brandId, accountKey, deviceId);
      const requestRef = getBrandCollection(db, brandId, 'device_approval_requests').doc(requestId);
      await db.runTransaction(async (transaction) => {
        const requestSnap = await transaction.get(requestRef);
        if (!requestSnap.exists || requestSnap.data()?.status !== 'pending') return;
        await resolvePendingRequestInTransaction({
          admin, transaction, db, brandId, requestRef, requestData: requestSnap.data() || {},
          nextStatus: isTrusted ? 'approved' : (isGlobalBlocked || isBlocked ? 'blocked' : (isObserving ? 'observing' : 'reverify_required')), actorName, actorRole: 'director', source: 'system_monitor',
          targetDevicePatch: nextDevice,
        });
      });
      await requestRef.collection('private').doc('verification').delete().catch(() => {});
      await writeSecurityLog({
        db, brandId,
        payload: {
          role: 'director', user: actorName, action: isTrusted
            ? '設為可使用裝置'
            : isGlobalBlocked
              ? '禁止所有品牌使用此裝置'
              : isBlocked
                ? '禁止此品牌使用此裝置'
                : isObserving
                  ? '裝置繼續觀察'
                  : '要求裝置重新驗證',
          activityType: 'security.device_manual_review', view: 'logs', device: device.device || '', browser: device.browser || '', os: device.os || '', deviceId, deviceShort: device.deviceShort || '',
          details: { targetUserName: profile.userName || profile.accountId || accountKey, nextStatus },
        },
      });
      return res.status(200).json({ ok: true, device: nextDevice });
    } catch (error) {
      console.error('manageAccountDevice failed', error);
      return res.status(500).json({ ok: false, message: '裝置狀態更新失敗，請稍後再試。' });
    }
  });

  const emergencyUnblockDevice = onRequest({ cors: true, timeoutSeconds: 20, memory: '256MiB' }, async (req, res) => {
    if (req.method !== 'POST') return res.status(405).json({ ok: false, message: 'method_not_allowed' });
    const requestAuth = await requireFirebaseRequestAuth(req, admin);
    if (!requestAuth.ok) return res.status(401).json({ ok: false, message: '登入狀態已失效，請重新登入' });
    try {
      const body = req.body || {};
      const brandId = normalizeBrandId(body.brandId);
      const masterPassword = String(body.masterPassword || '');
      if (!(await verifyMasterPassword({ db, brandId, password: masterPassword }))) {
        return res.status(403).json({ ok: false, message: '最高管理者密碼不正確' });
      }
      const roleId = String(body.roleId || '').trim();
      const accountId = sanitizeSecurityKey(body.accountId || '');
      const userName = String(body.userName || accountId);
      const deviceInfo = normalizeDeviceInfo(body.deviceInfo || {});
      const loginLocation = normalizeLocation(body.loginLocation || {});
      const blockedDeviceId = sanitizeSecurityKey(body.blockedDeviceId || '');
      if (!roleId || !accountId || !deviceInfo.deviceId) return res.status(400).json({ ok: false, message: '資料不完整' });
      const accountKey = sanitizeSecurityKey(`${brandId}_${roleId}_${accountId}`);
      const profileRef = getBrandCollection(db, brandId, 'account_devices').doc(accountKey);
      const profileSnap = await profileRef.get();
      const profileDevices = profileSnap.exists ? profileSnap.data()?.devices || {} : {};
      const existing = profileDevices?.[deviceInfo.deviceId] || {};
      const recoverableRisk = findRecoverableRiskDeviceEntry(profileDevices, deviceInfo, loginLocation);
      const recoverableKnown = findRecoverableKnownDeviceEntry(profileDevices, deviceInfo, loginLocation);
      const nowText = new Date().toISOString();
      const nextDevice = {
        ...existing,
        ...deviceInfo,
        trusted: true,
        status: 'trusted',
        source: 'emergency_master_unblocked',
        reviewedBy: '最高管理者救援',
        reviewedRole: 'master',
        reviewedAtText: nowText,
        emergencyUnblocked: true,
        emergencyUnblockedAtText: nowText,
        updatedAtText: nowText,
      };
      await profileRef.set({ brandId, brandLabel: getBrandLabel(brandId), role: roleId, accountId, userName, updatedAtText: nowText, devices: { [deviceInfo.deviceId]: nextDevice } }, { merge: true });
      const globalDeviceIds = [...new Set([
        deviceInfo.deviceId,
        blockedDeviceId,
        recoverableRisk?.storedDeviceId || '',
        recoverableKnown?.storedDeviceId || '',
      ].filter(Boolean))];
      await Promise.all(globalDeviceIds.map((candidateDeviceId) => (
        getGlobalBlockedRef(db, roleId, accountId, candidateDeviceId).set({
          active: false,
          status: 'resolved',
          source: 'emergency_master_unblocked',
          resolvedBy: '最高管理者救援',
          resolvedRole: 'master',
          resolvedAtText: nowText,
          updatedAtText: nowText,
        }, { merge: true })
      )));

      const requestId = makeRequestId(brandId, accountKey, deviceInfo.deviceId);
      const requestRef = getBrandCollection(db, brandId, 'device_approval_requests').doc(requestId);
      await db.runTransaction(async (transaction) => {
        const requestSnap = await transaction.get(requestRef);
        if (!requestSnap.exists || requestSnap.data()?.status !== 'pending') return;
        await resolvePendingRequestInTransaction({ admin, transaction, db, brandId, requestRef, requestData: requestSnap.data() || {}, nextStatus: 'approved', actorName: '最高管理者救援', actorRole: 'master', source: 'emergency_master_unblocked', targetDevicePatch: nextDevice });
      });
      await requestRef.collection('private').doc('verification').delete().catch(() => {});
      await writeSecurityLog({ db, brandId, payload: { role: 'master', user: '最高管理者救援', action: '最高管理者協助裝置恢復', activityType: 'security.emergency_unblock', view: 'login', device: deviceInfo.device, browser: deviceInfo.browser, os: deviceInfo.os, deviceId: deviceInfo.deviceId, deviceShort: deviceInfo.deviceShort, details: { targetRole: roleId, targetAccountId: accountId, targetUserName: userName } } });
      return res.status(200).json({ ok: true, message: '裝置已恢復使用，請重新登入。' });
    } catch (error) {
      console.error('emergencyUnblockDevice failed', error);
      return res.status(500).json({ ok: false, message: '目前無法完成救援，請稍後再試。' });
    }
  });

  const cleanupExpiredDeviceApprovals = onSchedule({ schedule: 'every 15 minutes', timeZone: 'Asia/Taipei', timeoutSeconds: 120, memory: '256MiB' }, async () => {
    const now = Date.now();
    for (const brandId of ['cyj', 'anniu', 'yibo']) {
      const snap = await getBrandCollection(db, brandId, 'device_approval_requests').where('expiresAtMs', '<=', now).limit(100).get();
      for (const docSnap of snap.docs) {
        const data = docSnap.data() || {};
        if (data.status !== 'pending') {
          await docSnap.ref.set({ expiresAtMs: admin.firestore.FieldValue.delete(), updatedAtText: new Date().toISOString() }, { merge: true });
          continue;
        }
        await db.runTransaction(async (transaction) => {
          const fresh = await transaction.get(docSnap.ref);
          if (!fresh.exists || fresh.data()?.status !== 'pending' || Number(fresh.data()?.expiresAtMs || 0) > Date.now()) return;
          await resolvePendingRequestInTransaction({
            admin, transaction, db, brandId, requestRef: docSnap.ref, requestData: fresh.data() || {},
            nextStatus: 'expired', actorName: '系統', actorRole: 'system', source: 'approval_expired',
            targetDevicePatch: {
              trusted: false,
              status: ['observing', 'reverify_required', 'suspicious'].includes(String(fresh.data()?.deviceStatus || ''))
                ? (String(fresh.data()?.deviceStatus || '') === 'suspicious' ? 'reverify_required' : String(fresh.data()?.deviceStatus || ''))
                : 'new',
              source: 'device_approval_expired',
            },
          });
        });
        await docSnap.ref.collection('private').doc('verification').delete().catch(() => {});
      }
    }
  });

  return {
    checkDeviceAccess,
    reviewDeviceApproval,
    reportLoginSecurityEvent,
    manageAccountDevice,
    emergencyUnblockDevice,
    cleanupExpiredDeviceApprovals,
  };
}

module.exports = {
  createDeviceApprovalFunctions,
  DEVICE_APPROVAL_DEFAULTS,
};

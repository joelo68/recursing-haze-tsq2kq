# Device Review Three-Level Update

## This release

App version stays unchanged:

```js
const CURRENT_APP_VERSION = "3.5.2";
```

Changed files:

- `src/App.jsx`
- `src/components/SystemMonitor.jsx`
- `src/components/DeviceApprovalPanel.jsx`
- `functions/deviceApproval.js`
- `tests/deviceApproval.test.js`

No change required:

- `functions/index.js`
- `firestore.rules`
- `src/components/DeviceApprovalGate.jsx`
- `src/components/LoginView.jsx`
- `src/components/SettingsView.jsx`

## New device review states

- `observing` / `manual_observing`: 繼續觀察。觀察模式下仍可正常使用，不會反覆建立新的驗證要求，也不會變成 Trusted。
- `reverify_required` / `manual_reverify_required`: 要求重新驗證。觀察模式下仍可使用，但使用者端會顯示「主管要求重新驗證」；未來切到正式驗證模式後，下次登入才進入原信任裝置＋6位碼確認流程。
- `blocked` / `manual_blocked`: 禁止此裝置。之後登入直接阻擋。

Legacy `reject_admin` / `suspicious_admin` backend actions are still accepted for backward compatibility, but are mapped to the new states.

## Validation

```bash
node --check functions/deviceApproval.js
npm run build
node --test tests/deviceApproval.test.js
```

Expected regression result for this package: 27/27 tests passed.

## Git

```bash
git add src/App.jsx \
  src/components/SystemMonitor.jsx \
  src/components/DeviceApprovalPanel.jsx \
  functions/deviceApproval.js \
  tests/deviceApproval.test.js

git commit -m "refine device review levels without app version bump"
git push origin main
```

## Firebase deploy

Because both frontend and backend behavior changed, deploy Hosting and the affected Device Approval functions:

```bash
firebase deploy --only "functions:checkDeviceAccess,functions:reviewDeviceApproval,functions:manageAccountDevice,functions:cleanupExpiredDeviceApprovals,hosting"
```

This deployment intentionally does **not** change `CURRENT_APP_VERSION`, so it will not trigger the app-version forced-update mechanism.

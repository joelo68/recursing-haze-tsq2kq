import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const read = (file) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');

test('therapist credential batch UI consumes the public highest-admin context contract', () => {
  const app = read('src/App.jsx');
  const maintenance = read('src/components/SystemMaintenance.jsx');

  assert.match(
    app,
    /canManageDeviceSecurity:\s*isDeviceSecuritySuperAdmin/,
    'AppContext must expose the established public highest-admin capability key'
  );
  assert.match(
    maintenance,
    /canManageDeviceSecurity:\s*isDeviceSecuritySuperAdmin/,
    'SystemMaintenance must consume the public AppContext capability key'
  );
  assert.doesNotMatch(
    maintenance,
    /manageTherapistMasterAction,\s*isDeviceSecuritySuperAdmin,\s*}\s*=\s*useContext\(AppContext\)/,
    'SystemMaintenance must not destructure a private/non-exported App variable name from context'
  );
});

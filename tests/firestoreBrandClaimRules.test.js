import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const rules = fs.readFileSync(path.join(ROOT, "firestore.rules"), "utf8");
const app = fs.readFileSync(path.join(ROOT, "src/App.jsx"), "utf8");
const identity = fs.readFileSync(path.join(ROOT, "functions/applicationIdentity.js"), "utf8");
const deviceApproval = fs.readFileSync(path.join(ROOT, "functions/deviceApproval.js"), "utf8");

test("P0-FINAL-1C-2 requires canonical Application Identity claims", () => {
  assert.match(rules, /function applicationIdentity\(\)/);
  assert.match(rules, /request\.auth\.token\.drcyjIdentity == true/);
  assert.match(rules, /request\.auth\.token\.identityVersion == 'application-identity-v1'/);
  assert.match(rules, /request\.auth\.token\.brandId in \['cyj', 'anniu', 'yibo'\]/);
  assert.match(rules, /request\.auth\.token\.roleId in \['director', 'trainer', 'manager', 'store', 'therapist'\]/);
  assert.match(rules, /request\.auth\.token\.accountId is string/);

  assert.match(identity, /APPLICATION_IDENTITY_VERSION = "application-identity-v1"/);
  assert.match(identity, /drcyjIdentity:\s*true/);
  assert.match(identity, /identityVersion:\s*APPLICATION_IDENTITY_VERSION/);
  assert.match(identity, /brandId:\s*brand/);
  assert.match(identity, /roleId:\s*role/);
  assert.match(identity, /accountId/);
});

test("new-brand broad fallback is same-brand only", () => {
  assert.match(
    rules,
    /match \/brands\/\{brandId\}\/\{collectionName\}\/\{document=\*\*\}\s*\{[\s\S]*?allow read, write: if sameBrandIdentity\(brandId\)/s
  );
  assert.doesNotMatch(
    rules,
    /match \/brands\/\{brandId\}\/\{collectionName\}\/\{document=\*\*\}\s*\{[\s\S]*?allow read, write: if signedIn\(\)/s
  );
});

test("CYJ legacy broad fallback requires CYJ claim and default legacy app id", () => {
  assert.match(rules, /function cyjLegacyIdentity\(appId\)/);
  assert.match(rules, /appId == 'default-app-id'/);
  assert.match(rules, /request\.auth\.token\.brandId == 'cyj'/);
  assert.match(
    rules,
    /match \/artifacts\/\{appId\}\/public\/data\/\{collectionName\}\/\{document=\*\*\}\s*\{[\s\S]*?allow read, write: if cyjLegacyIdentity\(appId\)/s
  );
});

test("anonymous bootstrap surface is narrow and does not receive generic data access", () => {
  assert.match(
    rules,
    /function anonymousBootstrap\(\)\s*\{[\s\S]*request\.auth\.token\.firebase\.sign_in_provider == 'anonymous'/s
  );
  assert.match(
    rules,
    /match \/brands\/\{brandId\}\/login_directory_summary\/\{document=\*\*\}\s*\{\s*allow read: if anonymousBootstrap\(\) \|\| sameBrandIdentity\(brandId\);/s
  );
  assert.match(
    rules,
    /settingId == 'system_version' && \(anonymousBootstrap\(\) \|\| applicationIdentity\(\)\)/
  );
  assert.doesNotMatch(
    rules,
    /match \/\{topLevel\}\/\{document=\*\*\}\s*\{[\s\S]*?if signedIn\(\)/s
  );
  assert.match(
    rules,
    /match \/\{topLevel\}\/\{document=\*\*\}\s*\{[\s\S]*?allow read, write: if applicationIdentity\(\)/s
  );
});

test("pending device request pre-session read is bound to bootstrap auth uid", () => {
  assert.match(rules, /function ownsBootstrapDeviceRequest\(\)/);
  assert.match(rules, /resource\.data\.bootstrapAuthUid == request\.auth\.uid/);
  assert.match(
    rules,
    /match \/brands\/\{brandId\}\/device_approval_requests\/\{requestId\}\s*\{\s*allow read: if sameBrandIdentity\(brandId\) \|\| ownsBootstrapDeviceRequest\(\);/s
  );
  assert.match(
    rules,
    /match \/artifacts\/\{appId\}\/public\/data\/device_approval_requests\/\{requestId\}\s*\{\s*allow read: if cyjLegacyIdentity\(appId\) \|\| \(appId == 'default-app-id' && ownsBootstrapDeviceRequest\(\)\);/s
  );

  assert.match(deviceApproval, /bootstrapAuthUid:\s*requestAuth\.uid/);
  assert.match(deviceApproval, /bootstrapAuthUid:\s*normalizedBootstrapAuthUid/);
});

test("protected backend-only writers remain closed to browser", () => {
  for (const pattern of [
    /therapist_credentials\/\{document=\*\*\}[\s\S]*?allow read, write: if false;/,
    /login_security_state\/\{document=\*\*\}[\s\S]*?allow read, write: if false;/,
    /global_blocked_devices\/\{document=\*\*\}[\s\S]*?allow read, write: if false;/,
  ]) {
    assert.match(rules, pattern);
  }
});

test("1C-2 is Rules-only and does not change frontend runtime version", () => {
  assert.match(app, /const CURRENT_APP_VERSION = "3\.6\.0";/);
});

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const app = read("src/App.jsx");
const applicationIdentity = read("functions/applicationIdentity.js");
const deviceApproval = read("functions/deviceApproval.js");
const rules = read("firestore.rules");

const sliceBetween = (source, startToken, endToken) => {
  const start = source.indexOf(startToken);
  const end = source.indexOf(endToken, start + startToken.length);
  assert.ok(start >= 0, `missing start token: ${startToken}`);
  assert.ok(end > start, `missing end token: ${endToken}`);
  return source.slice(start, end);
};

test("P0-FINAL-1C-1 moves bootstrap organization reads behind the sanitized directory backend", () => {
  const bootstrap = sliceBetween(
    app,
    "const fetchGlobalData = useCallback",
    "// P0-FINAL-1B：正式營運 authority"
  );

  assert.match(bootstrap, /LOGIN_DIRECTORY_ENDPOINT/);
  assert.match(bootstrap, /assertSanitizedLoginOrganization\(directoryResult\.organization, brandIdAtStart\)/);
  assert.match(bootstrap, /fetchGlobalData_core_docs", 0/);
  assert.doesNotMatch(bootstrap, /getDoc\(getDocPath\("org_structure"\)\)/);

  assert.match(applicationIdentity, /APPLICATION_ORGANIZATION_VERSION = "application-login-organization-v1"/);
  assert.match(applicationIdentity, /getBrandSettingDoc\(db, brand, "org_structure"\)\.get\(\)/);
  assert.match(applicationIdentity, /organization,\s*counts: getLoginDirectoryCounts\(directory\)/);
  assert.match(
    applicationIdentity,
    /readCount: Number\(sourceResult\.readCount \|\| 0\) \+ Number\(organizationResult\.readCount \|\| 0\)/
  );
});

test("P0-FINAL-1C-1 binds every pending device request to its verified Firebase bootstrap uid", () => {
  assert.match(deviceApproval, /bootstrapAuthUid:\s*requestAuth\.uid/);
  assert.match(deviceApproval, /const normalizedBootstrapAuthUid = String\(bootstrapAuthUid \|\| ''\)\.trim\(\)/);
  assert.match(deviceApproval, /if \(!normalizedBootstrapAuthUid\) throw new Error\('missing_bootstrap_auth_uid'\)/);
  assert.match(deviceApproval, /bootstrapAuthUid:\s*normalizedBootstrapAuthUid/);
});

test("P0-FINAL-1C-1 does not advance Rules lockdown or app version", () => {
  assert.match(rules, /function signedIn\(\)\s*\{\s*return request\.auth != null;/);
  assert.doesNotMatch(rules, /request\.auth\.token/);
  assert.match(app, /const CURRENT_APP_VERSION = "3\.6\.0";/);
});

test("bootstrap support adds no polling or backend realtime listener", () => {
  const directoryBlock = sliceBetween(
    applicationIdentity,
    "const getApplicationLoginDirectory = onRequest(",
    "return { getApplicationLoginDirectory };"
  );
  assert.doesNotMatch(directoryBlock, /setInterval\s*\(/);
  assert.doesNotMatch(directoryBlock, /onSnapshot\s*\(/);
});

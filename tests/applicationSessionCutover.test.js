import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const require = createRequire(import.meta.url);

const app = read("src/App.jsx");
const backend = read("functions/deviceApproval.js");
const rules = read("firestore.rules");
const {
  buildVerifiedApplicationIdentity,
} = require("../functions/applicationIdentity");

test("B1B2 requests the custom token through the existing checkDeviceAccess call without a second login endpoint", () => {
  assert.match(app, /requestApplicationIdentityToken:\s*true/);
  assert.match(app, /DEVICE_ACCESS_ENDPOINT/);
  assert.match(app, /applicationIdentityCustomToken/);
  assert.doesNotMatch(app, /APPLICATION_SESSION_ENDPOINT/);
});

test("custom token issuance is allowed-only and token failure fails closed", () => {
  assert.match(backend, /const sessionEligible = payload\?\.allowed === true/);
  assert.match(backend, /if \(requestApplicationIdentityToken && sessionEligible\)/);
  assert.match(backend, /application identity session token mint failed/);
  assert.match(backend, /code:\s*'application_identity_token_unavailable'/);
  assert.match(backend, /ok:\s*false,[\s\S]{0,120}allowed:\s*false,[\s\S]{0,160}credentialVerified:\s*true/);
});

test("frontend verifies brand role account uid and identity version before publishing application role", () => {
  const helperStart = app.indexOf("const activateApplicationIdentitySession");
  const loginStart = app.indexOf("const handleLogin");
  assert.ok(helperStart > 0 && loginStart > helperStart);

  const helper = app.slice(helperStart, loginStart);
  assert.match(helper, /signInWithCustomToken\(auth, customToken\)/);
  assert.match(helper, /getIdTokenResult\(true\)/);
  assert.match(helper, /claims\?\.drcyjIdentity === true/);
  assert.match(helper, /claims\?\.identityVersion/);
  assert.match(helper, /claims\?\.brandId/);
  assert.match(helper, /claims\?\.roleId/);
  assert.match(helper, /claims\?\.accountId/);
  assert.match(helper, /userCredential\.user\?\.uid/);

  const loginEnd = app.indexOf("const resumePendingDeviceLogin", loginStart);
  const login = app.slice(loginStart, loginEnd);
  assert.ok(
    login.indexOf("await activateApplicationIdentitySession") < login.indexOf("setUserRole(roleId)"),
    "application session must be active before role/currentUser are published"
  );
});

test("Firebase auth principal replacement does not rebuild every React user-gated listener", () => {
  assert.match(app, /setUser\(\(previous\) => \{[\s\S]{0,140}if \(!u\) return null;[\s\S]{0,100}return previous \|\| u;/);
  assert.match(app, /避免所有 \[user, \.\.\.\] listener/);
});

test("logout removes application claims by returning to anonymous bootstrap and has a signOut fallback", () => {
  const start = app.indexOf("const handleLogout");
  const end = app.indexOf("useEffect(() => {", start);
  assert.ok(start > 0 && end > start);
  const block = app.slice(start, end);
  assert.match(block, /applicationSessionIdentityRef\.current = null/);
  assert.match(block, /await signInAnonymously\(auth\)/);
  assert.match(block, /await signOut\(auth\)/);
  assert.ok(
    block.indexOf("await logActivity") < block.indexOf("await signInAnonymously(auth)"),
    "logout audit must run before application claims are dropped"
  );
});

test("custom token is never persisted by application code", () => {
  assert.doesNotMatch(app, /localStorage\.(?:setItem|getItem)\([^)]*applicationIdentityCustomToken/i);
  assert.doesNotMatch(app, /sessionStorage\.(?:setItem|getItem)\([^)]*applicationIdentityCustomToken/i);
  assert.doesNotMatch(app, /localStorage\.(?:setItem|getItem)\([^)]*customToken/i);
  assert.doesNotMatch(app, /sessionStorage\.(?:setItem|getItem)\([^)]*customToken/i);
});

test("master credential is not promoted into a durable Firebase custom claim", () => {
  const result = buildVerifiedApplicationIdentity({
    brandId: "cyj",
    roleId: "director",
    requestedAccountId: "director-001",
    credential: {
      ok: true,
      accountId: "director-001",
      userName: "測試主管",
      directorLevel: "operation_admin",
      isMasterCredential: true,
    },
  });

  assert.equal(result.identity.isMasterCredential, true);
  assert.equal(Object.prototype.hasOwnProperty.call(result.claims, "isMasterCredential"), false);
});

test("B1C2C1 retires raw credential bootstrap while Firestore Rules lockdown remains later", () => {
  assert.match(rules, /function signedIn\(\)\s*\{\s*return request\.auth != null;/);
  assert.match(app, /LOGIN_DIRECTORY_ENDPOINT/);
  const fetchStart = app.indexOf("const fetchGlobalData");
  const fetchEnd = app.indexOf("const unsubReadTrackerConfig", fetchStart);
  assert.ok(fetchStart > 0 && fetchEnd > fetchStart);
  const bootstrap = app.slice(fetchStart, fetchEnd);
  for (const rawSource of ["store_account_data", "manager_auth", "trainer_auth", "director_auth", "master_auth"]) {
    assert.doesNotMatch(bootstrap, new RegExp(`getDoc\\(getDocPath\\(\"${rawSource}\"\\)\\)`));
  }
  assert.match(app, /transitional admin hydration/);
  assert.match(app, /CURRENT_APP_VERSION\s*=\s*"3\.6\.0"/);
});

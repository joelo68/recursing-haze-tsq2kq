import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const app = read("src/App.jsx");
const login = read("src/components/LoginView.jsx");
const backend = read("functions/deviceApproval.js");
const rules = read("firestore.rules");

test("B1B1 credential verification remains mandatory under the B1B2 session cutover", () => {
  assert.match(app, /ok:\s*false,[\s\S]{0,120}allowed:\s*false,[\s\S]{0,120}credentialVerified:\s*false/);
  assert.match(app, /result\?\.credentialVerified !== true/);
  assert.match(app, /const credentialVerified = error\?\.result\?\.credentialVerified === true/);
  assert.match(app, /requestApplicationIdentityToken:\s*true/);
  assert.match(app, /allowed:\s*false,[\s\S]{0,180}credentialVerified,/);
});

test("offline or missing-role login can no longer bypass server credential authority", () => {
  assert.match(app, /if \(!isOnline \|\| !roleId\)\s*\{[\s\S]{0,260}ok:\s*false,[\s\S]{0,120}allowed:\s*false,[\s\S]{0,120}credentialVerified:\s*false/);
  assert.match(app, /目前無法完成帳號驗證，請確認網路後再試一次。/);
});

test("backend marks credential state explicitly before device-security and session decisions", () => {
  assert.match(backend, /let credentialVerified = false/);
  assert.match(backend, /if \(!requestAuth\.ok\) return res\.status\(401\)\.json\(\{ ok: false, credentialVerified: false/);
  assert.match(backend, /if \(!credential\.ok\) return res\.status\(401\)\.json\(\{ ok: false, credentialVerified: false/);
  assert.match(backend, /credentialVerified = true;/);
  assert.match(backend, /const sessionEligible = payload\?\.allowed === true/);
  assert.match(backend, /credentialVerified:\s*true,[\s\S]{0,220}applicationIdentity:/);
});

test("B1B2 fails closed when secure application session issuance is incomplete", () => {
  assert.match(backend, /return res\.status\(503\)\.json\(\{[\s\S]{0,220}credentialVerified,/);
  assert.match(app, /requestApplicationIdentityToken:\s*true/);
  assert.match(app, /allowed:\s*false,[\s\S]{0,120}credentialVerified,/);
  assert.match(app, /登入工作階段未建立/);
  assert.doesNotMatch(app, /const mustBlock = !credentialVerified \|\| shouldFailClosed/);
});

test("B1B1 keeps client password checks only as a temporary compatibility gate", () => {
  assert.match(login, /password === correctPass/);
  assert.match(login, /account && account\.password === password/);
  assert.match(login, /therapist && therapist\.password === tPassword/);
  for (const role of ["director", "trainer", "manager", "store", "therapist"]) {
    assert.match(login, new RegExp(`await onLogin\\("${role}"`));
  }
});

test("B1B2 consumes the server-issued application session while Firestore Rules remain intentionally unchanged", () => {
  assert.match(app, /requestApplicationIdentityToken\s*:\s*true/);
  assert.match(app, /applicationIdentityCustomToken/);
  assert.match(app, /signInWithCustomToken\(auth, customToken\)/);
  assert.match(app, /claims\?\.drcyjIdentity === true/);
  assert.match(app, /signInAnonymously\(auth\)/);
  assert.match(rules, /function signedIn\(\)\s*\{\s*return request\.auth != null;/);
  assert.match(app, /CURRENT_APP_VERSION\s*=\s*"3\.6\.0"/);
});

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
const rules = read("firestore.rules");

const DEDICATED_RUNTIME_SA = "drcyj-application-identity@cyjsituation-analysis.iam.gserviceaccount.com";

test("checkDeviceAccess is isolated onto the dedicated Application Identity runtime service account", () => {
  assert.match(
    backend,
    new RegExp(
      "const APPLICATION_IDENTITY_RUNTIME_SERVICE_ACCOUNT = '" +
      DEDICATED_RUNTIME_SA.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
      "';"
    )
  );

  const start = backend.indexOf("const checkDeviceAccess = onRequest({");
  const end = backend.indexOf("}, async (req, res) => {", start);
  assert.ok(start >= 0 && end > start, "checkDeviceAccess options block must exist");

  const options = backend.slice(start, end + 20);
  assert.match(options, /serviceAccount:\s*APPLICATION_IDENTITY_RUNTIME_SERVICE_ACCOUNT/);

  const assignments = backend.match(
    /serviceAccount:\s*APPLICATION_IDENTITY_RUNTIME_SERVICE_ACCOUNT/g
  ) || [];
  assert.equal(assignments.length, 1, "dedicated signer runtime SA must be scoped to checkDeviceAccess only");

  assert.doesNotMatch(
    backend,
    /139860745126-compute@developer\.gserviceaccount\.com/,
    "shared Default Compute SA must not be hard-coded into the Application Identity authority"
  );
});

test("custom token authority remains allowed-only and fails closed if minting is unavailable", () => {
  assert.match(backend, /const sessionEligible = payload\?\.allowed === true/);
  assert.match(backend, /if \(requestApplicationIdentityToken && sessionEligible\)/);
  assert.match(backend, /admin\.auth\(\)\.createCustomToken/);
  assert.match(backend, /code:\s*'application_identity_token_unavailable'/);
  assert.match(
    backend,
    /ok:\s*false,[\s\S]{0,120}allowed:\s*false,[\s\S]{0,180}credentialVerified:\s*true/
  );
});

test("dedicated runtime-SA incident fix does not advance Rules lockdown or app version", () => {
  assert.match(app, /CURRENT_APP_VERSION\s*=\s*"3\.6\.0"/);
  assert.match(rules, /function signedIn\(\)\s*\{\s*return request\.auth != null;/);
  assert.doesNotMatch(rules, /request\.auth\.token\.drcyjIdentity/);
});

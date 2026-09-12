import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), "utf8");

const backend = read("functions/deviceApproval.js");

const APPLICATION_IDENTITY_SA =
  "drcyj-application-identity@cyjsituation-analysis.iam.gserviceaccount.com";
const DEVICE_REVIEW_SA =
  "drcyj-device-approval@cyjsituation-analysis.iam.gserviceaccount.com";

function getOptionsBlock(functionName) {
  const start = backend.indexOf(`const ${functionName} = onRequest({`);
  const end = backend.indexOf("}, async (req, res) => {", start);
  assert.ok(start >= 0 && end > start, `${functionName} options block must exist`);
  return backend.slice(start, end + 20);
}

test("B1C2B.1 reviewDeviceApproval uses its own least-privilege runtime identity contract", () => {
  assert.match(
    backend,
    /const DEVICE_REVIEW_RUNTIME_SERVICE_ACCOUNT = 'drcyj-device-approval@cyjsituation-analysis\.iam\.gserviceaccount\.com';/
  );

  const options = getOptionsBlock("reviewDeviceApproval");
  assert.match(
    options,
    /serviceAccount:\s*DEVICE_REVIEW_RUNTIME_SERVICE_ACCOUNT/
  );

  const assignments =
    backend.match(/serviceAccount:\s*DEVICE_REVIEW_RUNTIME_SERVICE_ACCOUNT/g) || [];
  assert.equal(
    assignments.length,
    1,
    "device-review runtime SA must be scoped to reviewDeviceApproval only"
  );
});

test("checkDeviceAccess keeps the separate Application Identity signer runtime", () => {
  assert.match(
    backend,
    /const APPLICATION_IDENTITY_RUNTIME_SERVICE_ACCOUNT = 'drcyj-application-identity@cyjsituation-analysis\.iam\.gserviceaccount\.com';/
  );

  const options = getOptionsBlock("checkDeviceAccess");
  assert.match(
    options,
    /serviceAccount:\s*APPLICATION_IDENTITY_RUNTIME_SERVICE_ACCOUNT/
  );
  assert.doesNotMatch(
    options,
    /DEVICE_REVIEW_RUNTIME_SERVICE_ACCOUNT/
  );
  assert.notEqual(
    APPLICATION_IDENTITY_SA,
    DEVICE_REVIEW_SA,
    "token-minting login authority and device-review authority must stay separated"
  );
});

test("device review runtime hardening does not hard-code or reuse Default Compute", () => {
  assert.doesNotMatch(
    backend,
    /139860745126-compute@developer\.gserviceaccount\.com/
  );
  assert.doesNotMatch(
    getOptionsBlock("reviewDeviceApproval"),
    /APPLICATION_IDENTITY_RUNTIME_SERVICE_ACCOUNT/
  );
});

test("reviewDeviceApproval keeps credential re-verification and existing resolution transaction behavior", () => {
  const start = backend.indexOf("const reviewDeviceApproval = onRequest({");
  const end = backend.indexOf("\n  const reportLoginSecurityEvent = onRequest(", start);
  assert.ok(start >= 0 && end > start, "reviewDeviceApproval body must exist");
  const body = backend.slice(start, end);

  assert.match(body, /requireFirebaseRequestAuth\(req,\s*admin\)/);
  assert.match(body, /verifyApplicationCredential\(\{/);
  assert.match(body, /verifyTrustedApproverDevice\(\{/);
  assert.match(body, /verifySuperAdminActor\(\{/);
  assert.match(body, /db\.runTransaction\(async \(transaction\) => \{/);
  assert.match(body, /resolvePendingRequestInTransaction\(\{/);
  assert.match(body, /DEVICE_APPROVAL_MAX_FAILED_ATTEMPTS/);
});

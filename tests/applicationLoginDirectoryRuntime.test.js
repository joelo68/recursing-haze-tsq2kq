import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), "utf8");
const require = createRequire(import.meta.url);

const {
  LOGIN_DIRECTORY_RUNTIME_SERVICE_ACCOUNT,
  APPLICATION_DIRECTORY_BRANDS,
  normalizeDirectoryBrandId,
  createApplicationIdentityFunctions,
} = require("../functions/applicationIdentity");

const applicationIdentitySource = read("functions/applicationIdentity.js");
const functionsIndex = read("functions/index.js");
const app = read("src/App.jsx");

const EXPECTED_RUNTIME_SA =
  "drcyj-login-directory@cyjsituation-analysis.iam.gserviceaccount.com";

function makeDocSnap(data = {}, exists = true) {
  return {
    exists,
    data: () => data,
  };
}

function makeFactory({
  authOk = true,
  normalizer = (value) => String(value || "").trim().toLowerCase(),
  reads = [],
  onRequestOptions = [],
} = {}) {
  const onRequest = (options, handler) => {
    onRequestOptions.push(options);
    return handler;
  };

  return createApplicationIdentityFunctions({
    onRequest,
    db: {},
    normalizeBrandId: normalizer,
    getBrandSettingDoc: (_db, brandId, name) => ({
      get: async () => {
        reads.push(`setting:${brandId}:${name}`);
        return makeDocSnap({});
      },
    }),
    getBrandCollection: (_db, brandId, name) => ({
      get: async () => {
        reads.push(`collection:${brandId}:${name}`);
        return { docs: [] };
      },
    }),
    requireFirebaseRequestAuth: async () => ({ ok: authOk, uid: authOk ? "test-user" : "" }),
  });
}

async function invoke(handler, body = {}) {
  let statusCode = 0;
  let responseBody = null;
  const headers = {};

  await handler(
    { method: "POST", body },
    {
      set(name, value) { headers[name] = value; },
      status(code) { statusCode = code; return this; },
      json(payload) { responseBody = payload; return payload; },
    }
  );

  return { statusCode, responseBody, headers };
}

test("directory runtime is isolated onto the dedicated login-directory service-account contract", () => {
  assert.equal(LOGIN_DIRECTORY_RUNTIME_SERVICE_ACCOUNT, EXPECTED_RUNTIME_SA);

  const onRequestOptions = [];
  makeFactory({ onRequestOptions });

  assert.equal(onRequestOptions.length, 1);
  assert.equal(onRequestOptions[0].serviceAccount, EXPECTED_RUNTIME_SA);
  assert.equal(onRequestOptions[0].memory, "256MiB");
  assert.equal(onRequestOptions[0].timeoutSeconds, 20);

  assert.doesNotMatch(
    applicationIdentitySource,
    /139860745126-compute@developer\.gserviceaccount\.com/
  );
  assert.doesNotMatch(
    applicationIdentitySource,
    /drcyj-application-identity@cyjsituation-analysis\.iam\.gserviceaccount\.com/
  );
});

test("directory brand scope is explicit and unknown or missing brands fail closed", async () => {
  assert.deepEqual([...APPLICATION_DIRECTORY_BRANDS], ["cyj", "anniu", "yibo"]);
  assert.equal(normalizeDirectoryBrandId("cyj"), "cyj");
  assert.equal(normalizeDirectoryBrandId("ANNIU"), "anniu");
  assert.equal(normalizeDirectoryBrandId(" yibo "), "yibo");
  assert.equal(normalizeDirectoryBrandId("default-app-id"), "cyj");
  assert.equal(normalizeDirectoryBrandId(""), "");
  assert.equal(normalizeDirectoryBrandId("default"), "");
  assert.equal(normalizeDirectoryBrandId("unknown-brand"), "");

  const reads = [];
  const normalizerCalls = [];
  const handler = makeFactory({
    reads,
    normalizer: (value) => {
      normalizerCalls.push(value);
      return ["cyj", "anniu", "yibo"].includes(value) ? value : "cyj";
    },
  }).getApplicationLoginDirectory;

  const unknown = await invoke(handler, { brandId: "unknown-brand" });
  assert.equal(unknown.statusCode, 400);
  assert.equal(unknown.responseBody?.code, "unsupported_brand");
  assert.deepEqual(reads, []);
  assert.deepEqual(normalizerCalls, []);

  const missing = await invoke(handler, {});
  assert.equal(missing.statusCode, 400);
  assert.equal(missing.responseBody?.code, "unsupported_brand");
  assert.deepEqual(reads, []);
  assert.deepEqual(normalizerCalls, []);
});

test("directory keeps explicit default-app-id compatibility without cross-brand fallback", async () => {
  const reads = [];
  const handler = makeFactory({ reads }).getApplicationLoginDirectory;

  const legacy = await invoke(handler, { brandId: "default-app-id" });
  assert.equal(legacy.statusCode, 200);
  assert.equal(legacy.responseBody?.directory?.brandId, "cyj");
  assert.deepEqual(reads.sort(), [
    "collection:cyj:therapists",
    "setting:cyj:director_auth",
    "setting:cyj:manager_auth",
    "setting:cyj:store_account_data",
    "setting:cyj:trainer_auth",
  ].sort());

  reads.length = 0;
  const yibo = await invoke(handler, { brandId: "yibo" });
  assert.equal(yibo.statusCode, 200);
  assert.equal(yibo.responseBody?.directory?.brandId, "yibo");
  assert.deepEqual(reads.sort(), [
    "collection:yibo:therapists",
    "setting:yibo:director_auth",
    "setting:yibo:manager_auth",
    "setting:yibo:store_account_data",
    "setting:yibo:trainer_auth",
  ].sort());
});

test("directory source remains sanitized and request-scoped after frontend cutover", () => {
  assert.match(
    functionsIndex,
    /exports\.getApplicationLoginDirectory\s*=\s*applicationIdentityFunctions\.getApplicationLoginDirectory/
  );
  assert.match(applicationIdentitySource, /Cache-Control", "private, no-store"/);
  assert.doesNotMatch(applicationIdentitySource, /master_auth/);
  assert.doesNotMatch(applicationIdentitySource, /setInterval\s*\(/);
  assert.doesNotMatch(applicationIdentitySource, /onSnapshot\s*\(/);
  assert.match(app, /LOGIN_DIRECTORY_ENDPOINT/);
  assert.match(app, /loginDirectory=\{loginDirectory\}/);

  const directoryBlockStart = applicationIdentitySource.indexOf("const getApplicationLoginDirectory = onRequest(");
  const directoryBlockEnd = applicationIdentitySource.indexOf("return { getApplicationLoginDirectory };", directoryBlockStart);
  const directoryBlock = applicationIdentitySource.slice(directoryBlockStart, directoryBlockEnd);

  assert.ok(directoryBlockStart >= 0 && directoryBlockEnd > directoryBlockStart);
  assert.doesNotMatch(directoryBlock, /password\s*:/i);
});

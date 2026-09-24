import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

test("P1-A CI workflow exists and never deploys production", () => {
  const workflow = read(".github/workflows/ci-validation.yml");

  assert.match(workflow, /name: CI Validation Gate/);
  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /push:/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /permissions:\s*\n\s*contents: read/);
  assert.match(workflow, /node-version: "22"/);
  assert.match(workflow, /java-version: "21"/);
  assert.match(workflow, /npm run ci:validate/);
  assert.match(workflow, /npm run ci:rules/);

  assert.doesNotMatch(workflow, /firebase\s+deploy/);
  assert.doesNotMatch(workflow, /npm\s+run\s+deploy/);
  assert.doesNotMatch(workflow, /gh-pages\s+-d/);
  assert.doesNotMatch(workflow, /contents:\s*write/);
});

test("P1-A local CI commands are source-controlled, emulator-complete and Firebase CLI is pinned", () => {
  const pkg = JSON.parse(read("package.json"));
  const firebase = JSON.parse(read("firebase.json"));

  assert.equal(pkg.scripts?.["ci:validate"], "node scripts/ci-validate.mjs");
  assert.match(pkg.scripts?.["ci:rules"] || "", /firebase-tools@15\.30\.2/);
  assert.match(pkg.scripts?.["ci:rules"] || "", /--only firestore,auth/);
  assert.match(pkg.scripts?.["ci:rules"] || "", /--test-concurrency=1/);

  assert.equal(firebase.emulators?.firestore?.port, 8080);
  assert.equal(firebase.emulators?.auth?.port, 9099);
});

test("P1-A core validation includes syntax, full regression, build and security owner gates", () => {
  const source = read("scripts/ci-validate.mjs");

  assert.match(source, /git", \["diff", "--check"\]/);
  assert.match(source, /"--check", file/);
  assert.match(source, /FULL NON-EMULATOR REGRESSION/);
  assert.match(source, /\["run", "build"\]/);

  for (const owner of [
    "adminCredentialWriterRetirement.test.js",
    "managementDelegationWriterRetirement.test.js",
    "orgStructureWriterRetirement.test.js",
    "therapistCredentialRetirement.test.js",
    "therapistMasterWriteLockdown.test.js",
    "firestoreBrandClaimRulesEmulator.test.mjs",
    "administrativeSettingsRulesEmulator.test.mjs",
    "managementDelegationRulesEmulator.test.mjs",
    "managerOrganizationRulesEmulator.test.mjs",
  ]) {
    assert.match(source, new RegExp(owner.replaceAll(".", "\\.")));
  }

  assert.doesNotMatch(source, /firebase\s+deploy/);
  assert.doesNotMatch(source, /gh-pages/);
});

test("P1-A does not change application version ownership", () => {
  assert.match(
    read("src/App.jsx"),
    /const CURRENT_APP_VERSION = "3\.6\.0";/,
  );
});

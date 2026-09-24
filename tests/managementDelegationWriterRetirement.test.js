import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

const app = read("src/App.jsx");
const settings = read("src/components/SettingsView.jsx");
const backend = read("functions/managementDelegationAuthority.js");
const rules = read("firestore.rules");

test("P0-FINAL-1D-A2-2 retires Browser delegation writers and routes create/update/end through backend", () => {
  assert.match(app, /MANAGE_MANAGEMENT_DELEGATION_ENDPOINT/);
  assert.match(app, /const manageManagementDelegationAction = useCallback/);
  assert.match(settings, /manageManagementDelegationAction/);

  assert.doesNotMatch(
    settings,
    /setDoc\(\s*doc\(\s*getCollectionPath\("management_delegations"\)/
  );
  assert.doesNotMatch(
    settings,
    /addDoc\(\s*getCollectionPath\("maintenance_logs"\)/
  );

  assert.match(settings, /action:\s*editingDelegationId\s*\?\s*"update"\s*:\s*"create"/);
  assert.match(settings, /action:\s*"end"/);
  assert.match(settings, /expectedDelegation/);

  assert.match(backend, /db\.runTransaction/);
  assert.match(backend, /management_delegation_authority/);
  assert.match(backend, /delegation_overlap_conflict/);
  assert.match(backend, /assertExpectedDelegationSnapshot/);
});

test("A2-2 rules preserve same-brand read but Browser-lock delegation and authority-state writes for both path families", () => {
  assert.match(
    rules,
    /match \/brands\/\{brandId\}\/management_delegations\/\{delegationId\}[\s\S]{0,220}allow read:\s*if sameBrandIdentity\(brandId\)[\s\S]{0,120}allow write:\s*if false/
  );
  assert.match(
    rules,
    /match \/artifacts\/\{appId\}\/public\/data\/management_delegations\/\{delegationId\}[\s\S]{0,220}allow read:\s*if cyjLegacyIdentity\(appId\)[\s\S]{0,120}allow write:\s*if false/
  );
  assert.match(
    rules,
    /match \/brands\/\{brandId\}\/management_delegation_authority\/\{document=\*\*\}[\s\S]{0,180}allow read, write:\s*if false/
  );
  assert.match(
    rules,
    /match \/artifacts\/\{appId\}\/public\/data\/management_delegation_authority\/\{document=\*\*\}[\s\S]{0,180}allow read, write:\s*if false/
  );

  assert.match(
    rules,
    /match \/brands\/\{brandId\}\/\{collectionName\}\/\{document=\*\*\}[\s\S]{0,1600}collectionName != 'management_delegations'[\s\S]{0,200}collectionName != 'management_delegation_authority'/
  );
  assert.match(
    rules,
    /match \/artifacts\/\{appId\}\/public\/data\/\{collectionName\}\/\{document=\*\*\}[\s\S]{0,1600}collectionName != 'management_delegations'[\s\S]{0,200}collectionName != 'management_delegation_authority'/
  );
});

test("A2-2 adds no delegation realtime listener/polling and leaves CURRENT_APP_VERSION unchanged", () => {
  assert.match(app, /CURRENT_APP_VERSION\s*=\s*"3\.6\.0"/);
  const changed = `${app}\n${settings}\n${backend}`;
  assert.doesNotMatch(
    changed,
    /onSnapshot\([^)]*management_delegations|management_delegations[\s\S]{0,120}onSnapshot\(/
  );
  assert.doesNotMatch(
    changed,
    /setInterval\([^)]*management_delegations|management_delegations[\s\S]{0,120}setInterval\(/
  );
});

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
const maintenance = read("src/components/SystemMaintenance.jsx");
const backend = read("functions/managerOrganizationAuthority.js");
const rules = read("firestore.rules");

test("P0-FINAL-1D-A2-1 retires Browser org_structure writers and routes all mutations through backend authority", () => {
  assert.doesNotMatch(app, /managerOrder backfill failed/);
  assert.doesNotMatch(app, /setDoc\(\s*getDocPath\("org_structure"\)/);

  assert.doesNotMatch(settings, /saveOrgStructure\s*=/);
  assert.doesNotMatch(settings, /createOrgStructureSnapshot\s*=/);
  assert.doesNotMatch(settings, /(?:setDoc|updateDoc)\(\s*getDocPath\("org_structure"\)/);
  assert.match(settings, /action:\s*"assign_store"/);
  assert.match(settings, /"delete_unassigned_store"/);
  assert.match(settings, /"move_store_to_unassigned"/);

  assert.doesNotMatch(maintenance, /setDoc\(\s*getDocPath\("org_structure"\)/);
  assert.doesNotMatch(maintenance, /addDoc\(\s*getCollectionPath\("org_structure_snapshots"\)/);
  assert.match(maintenance, /action:\s*"restore_snapshot"/);

  assert.match(backend, /STORE_ORGANIZATION_ACTIONS/);
  assert.match(backend, /RESTORE_ORGANIZATION_ACTION/);
  assert.match(backend, /expectedOrganizationSignature/);
  assert.match(backend, /db\.runTransaction/);
});

test("P0-FINAL-1D-A2-1 rules keep org_structure and its restore snapshots readable but Browser-write locked for all brands", () => {
  assert.match(
    rules,
    /match \/brands\/\{brandId\}\/settings\/org_structure[\s\S]{0,220}allow read:[\s\S]{0,120}allow write:\s*if false/
  );
  assert.match(
    rules,
    /match \/artifacts\/\{appId\}\/public\/data\/global_settings\/org_structure[\s\S]{0,220}allow read:[\s\S]{0,120}allow write:\s*if false/
  );
  assert.match(
    rules,
    /match \/brands\/\{brandId\}\/org_structure_snapshots\/\{document=\*\*\}[\s\S]{0,220}allow write:\s*if false/
  );
  assert.match(
    rules,
    /match \/artifacts\/\{appId\}\/public\/data\/org_structure_snapshots\/\{document=\*\*\}[\s\S]{0,220}allow write:\s*if false/
  );

  assert.match(
    rules,
    /match \/brands\/\{brandId\}\/settings\/\{settingId\}\/\{document=\*\*\}[\s\S]{0,1200}settingId != 'org_structure'/
  );
  assert.match(
    rules,
    /match \/artifacts\/\{appId\}\/public\/data\/global_settings\/\{settingId\}[\s\S]{0,1400}settingId != 'org_structure'/
  );
  assert.match(
    rules,
    /match \/brands\/\{brandId\}\/\{collectionName\}\/\{document=\*\*\}[\s\S]{0,1400}collectionName != 'org_structure_snapshots'/
  );
  assert.match(
    rules,
    /match \/artifacts\/\{appId\}\/public\/data\/\{collectionName\}\/\{document=\*\*\}[\s\S]{0,1400}collectionName != 'org_structure_snapshots'/
  );
});

test("P0-FINAL-1D-A2-1 keeps CURRENT_APP_VERSION unchanged and adds no new realtime/polling primitive in the changed UI surfaces", () => {
  assert.match(app, /CURRENT_APP_VERSION\s*=\s*"3\.6\.0"/);
  const changedUi = `${app}\n${settings}\n${maintenance}`;
  assert.doesNotMatch(changedUi, /setInterval\([^)]*org_structure|org_structure[\s\S]{0,120}setInterval\(/);
  assert.doesNotMatch(changedUi, /onSnapshot\([^)]*org_structure|org_structure[\s\S]{0,120}onSnapshot\(/);
});

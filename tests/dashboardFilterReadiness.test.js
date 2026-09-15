import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const viewSource = read("src/components/DashboardView.jsx");
const headerSource = read("src/components/DashboardHeader.jsx");
const hookSource = read("src/hooks/useDashboardStats.js");
const appSource = read("src/App.jsx");

test("B1C2E-UX2B anchors Dashboard filter readiness to current-brand System Exclusion authority", () => {
  assert.match(
    viewSource,
    /const \{ userRole, therapistModuleEnabled, systemExclusionState \} = useContext\(AppContext\);/
  );
  assert.match(viewSource, /const dashboardStoreScopeReady = Boolean\(/);
  assert.match(viewSource, /systemExclusionState\?\.ready === true/);
  assert.match(
    viewSource,
    /String\(systemExclusionState\?\.brandId \|\| ""\)\.trim\(\)\.toLowerCase\(\)/
  );
  assert.match(
    viewSource,
    /String\(brandInfo\?\.id \|\| ""\)\.trim\(\)\.toLowerCase\(\)/
  );
  assert.match(viewSource, /storeScopeReady=\{dashboardStoreScopeReady\}/);
});

test("B1C2E-UX2B keeps filter controls present but masks unresolved store scope", () => {
  assert.match(headerSource, /storeScopeReady = false/);
  assert.match(headerSource, /const showStoreScopeControl = storeScopeReady/);
  assert.match(headerSource, /\{showStoreScopeControl && \(/);
  assert.match(headerSource, /value=\{storeScopeReady \? selectedDashboardManager : ""\}/);
  assert.match(headerSource, /value=\{storeScopeReady \? selectedDashboardStore : ""\}/);
  assert.ok((headerSource.match(/disabled=\{!storeScopeReady\}/g) || []).length >= 2);
  assert.ok((headerSource.match(/aria-busy=\{!storeScopeReady\}/g) || []).length >= 2);
  assert.match(headerSource, /storeScopeReady \? "全品牌" : "範圍同步中\.\.\."/);
  assert.match(headerSource, /"店家範圍同步中\.\.\."/);
});

test("B1C2E-UX2B does not expose manager/store option lists before scope readiness", () => {
  assert.match(headerSource, /\{storeScopeReady && Object\.keys\(groupedStoresForFilter\)\.map/);
  assert.match(headerSource, /\{storeScopeReady && \(isScopedOperator \? \(/);
  assert.match(
    headerSource,
    /const hasDelegatedStores = storeScopeReady && delegatedStoresForDropdown\.length > 0;/
  );
});

test("B1C2E-UX2B preserves UX2A shell and section readiness isolation", () => {
  assert.match(viewSource, /<DashboardHeader/);
  assert.match(viewSource, /\{isStoreViewActive && \(/);
  assert.match(viewSource, /\{isTherapistViewActive && \(/);
  assert.match(viewSource, /DashboardSectionLoading label="門市營運資料載入中\.\.\."/);
  assert.match(viewSource, /DashboardSectionLoading label="人員績效資料載入中\.\.\."/);
});

test("B1C2E-UX2B changes no read topology or projection authority", () => {
  const changedRuntime = `${viewSource}\n${headerSource}`;
  assert.doesNotMatch(
    changedRuntime,
    /\bonSnapshot\b|\bgetDoc\b|\bgetDocs\b|\bcollection\s*\(|\bquery\s*\(|\bsetInterval\s*\(|\bsetTimeout\s*\(/
  );
  assert.match(hookSource, /doc\(getCollectionPath\("projection_models"\), PROJECTION_MODEL_DOC_ID\)/);
  assert.match(hookSource, /const projectionPresentationReady = useMemo/);
  assert.match(hookSource, /activeCashAvailable && projectionPresentationReady/);
});

test("B1C2E-UX2B does not change CURRENT_APP_VERSION", () => {
  assert.match(appSource, /const CURRENT_APP_VERSION = "3\.6\.0";/);
});

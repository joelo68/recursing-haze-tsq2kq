// scripts/activity-sales-preflight.mjs
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const EXPECTED_BRANCH = "feature/activity-sales-center";
const DEMO_PROJECT_ID = "demo-drcyj-activity-sales";
const FORBIDDEN_PROJECT_ID = "cyjsituation-analysis";

const branch = execFileSync("git", ["branch", "--show-current"], {
  encoding: "utf8",
}).trim();

if (branch !== EXPECTED_BRANCH) {
  throw new Error(
    `Activity Sales 開發只能在 ${EXPECTED_BRANCH} 執行；目前是 ${branch || "UNKNOWN"}`
  );
}

const localConfig = fs.readFileSync("firebase.activity-sales.local.json", "utf8");
if (localConfig.includes(FORBIDDEN_PROJECT_ID)) {
  throw new Error("本機 Activity Sales emulator config 不得包含 Production project id");
}

const runtimeSource = fs.readFileSync("src/config/runtimeEnvironment.js", "utf8");
for (const required of [
  `const DEMO_PROJECT_ID = "${DEMO_PROJECT_ID}"`,
  'requestedProjectId.startsWith("demo-")',
  "PRODUCTION_FUNCTION_ROUTES",
  "resolveActivitySalesDevFunctionUrl",
  "__DRCYJ_ACTIVITY_SALES_FETCH_ISOLATED__",
]) {
  if (!runtimeSource.includes(required)) {
    throw new Error(`Activity Sales isolation guard missing: ${required}`);
  }
}

const firebaseSource = fs.readFileSync("src/config/firebase.js", "utf8");
for (const required of [
  "connectAuthEmulator",
  "connectFirestoreEmulator",
  "ACTIVITY_SALES_DEV_MODE",
]) {
  if (!firebaseSource.includes(required)) {
    throw new Error(`Activity Sales Firebase isolation guard missing: ${required}`);
  }
}

const appSource = fs.readFileSync("src/App.jsx", "utf8");
if (appSource.includes("resolveRuntimeFunctionEndpoint")) {
  throw new Error(
    "正式 App endpoint source shape 不應被 Activity Sales staging infrastructure 改寫"
  );
}

console.log("ACTIVITY_SALES_PREFLIGHT=PASS");
console.log(`BRANCH=${branch}`);
console.log(`DEMO_PROJECT_ID=${DEMO_PROJECT_ID}`);
console.log("FORMAL_APP_ENDPOINT_SOURCE_SHAPE=PRESERVED");
console.log("PRODUCTION_PROJECT_ALLOWED_IN_ACTIVITY_DEV=NO");
console.log("PRODUCTION_DEPLOY=BLOCKED_BY_WORKFLOW");

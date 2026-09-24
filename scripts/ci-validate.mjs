import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

const run = (command, args, label) => {
  console.log(`\n=== ${label} ===`);
  const result = spawnSync(command, args, {
    cwd: ROOT,
    stdio: "inherit",
    env: process.env,
  });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
};

const walkJs = (dir) => {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", ".git"].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkJs(full));
    else if (entry.isFile() && entry.name.endsWith(".js")) out.push(full);
  }
  return out.sort();
};

const required = [
  "package-lock.json",
  "functions/package.json",
  "functions/package-lock.json",
  "firebase.json",
  "firestore.rules",
  "tests/adminCredentialWriterRetirement.test.js",
  "tests/managementDelegationWriterRetirement.test.js",
  "tests/orgStructureWriterRetirement.test.js",
  "tests/therapistCredentialRetirement.test.js",
  "tests/therapistMasterWriteLockdown.test.js",
  "tests/firestoreBrandClaimRulesEmulator.test.mjs",
  "tests/administrativeSettingsRulesEmulator.test.mjs",
  "tests/managementDelegationRulesEmulator.test.mjs",
  "tests/managerOrganizationRulesEmulator.test.mjs",
];

console.log("=== P1-A SOURCE / SECURITY GATE ===");
for (const rel of required) {
  if (!fs.existsSync(path.join(ROOT, rel))) {
    throw new Error(`required CI owner missing: ${rel}`);
  }
}

const functionsPackage = JSON.parse(
  fs.readFileSync(path.join(ROOT, "functions/package.json"), "utf8"),
);
if (String(functionsPackage?.engines?.node) !== "22") {
  throw new Error("Functions Node runtime must remain 22");
}

const appSource = fs.readFileSync(path.join(ROOT, "src/App.jsx"), "utf8");
const versionMatch = appSource.match(/const CURRENT_APP_VERSION = "([^"]+)";/);
if (!versionMatch) throw new Error("CURRENT_APP_VERSION source anchor missing");

console.log(`CURRENT_APP_VERSION=${versionMatch[1]}`);
console.log("Functions runtime=node22");
console.log("Required security/writer-retirement tests=present");
console.log("SOURCE_SECURITY_GATE=PASS");

run("git", ["diff", "--check"], "WORKTREE DIFF CHECK");
run("git", ["diff", "--cached", "--check"], "STAGED DIFF CHECK");

const functionSources = walkJs(path.join(ROOT, "functions"));
console.log(`\nFunctions JS files for syntax check: ${functionSources.length}`);
for (const file of functionSources) {
  run(process.execPath, ["--check", file], `NODE CHECK ${path.relative(ROOT, file)}`);
}

const nonEmulatorTests = fs
  .readdirSync(path.join(ROOT, "tests"))
  .filter((name) => name.endsWith(".test.js"))
  .sort()
  .map((name) => path.join("tests", name));

console.log(`\nNon-emulator test files: ${nonEmulatorTests.length}`);
run(
  process.execPath,
  ["--test", ...nonEmulatorTests],
  "FULL NON-EMULATOR REGRESSION",
);

run(npmCommand, ["run", "build"], "PRODUCTION BUILD");

console.log("\n============================================================");
console.log("CI_CORE_VALIDATION=PASS");
console.log(`CURRENT_APP_VERSION=${versionMatch[1]} unchanged by CI`);
console.log("DEPLOY_ACTION=NONE");
console.log("============================================================");

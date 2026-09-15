import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const functionsRoot = path.join(repoRoot, "functions");

const retired = [
  "functions/AI_START_HERE.md",
  "functions/ARCHITECTURE.md",
  "functions/CURRENT_STATE.md",
  "functions/DATA_IDENTITY_RULES.md",
  "functions/DEPLOYMENT.md",
  "functions/DEVELOPMENT_GUIDE.md",
  "functions/KNOWLEDGE_BASE_MANIFEST.json",
  "functions/README.md",
  "functions/SYSTEM_SOURCE_MAP.md",
  "functions/docs/AUTH_AND_SECURITY.md",
  "functions/docs/DASHBOARD_SUMMARY.md",
  "functions/docs/DATA_FLOW.md",
  "functions/docs/FIREBASE_DATA_MODEL.md",
  "functions/docs/MAINTENANCE_TOOLS.md",
  "functions/docs/README.md",
  "functions/docs/TELEGRAM_AGENT.md",
  "functions/index.backup.js",
];

function walk(dir, base = dir) {
  const out = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;

    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      out.push(...walk(full, base));
      continue;
    }

    if (entry.isFile()) {
      out.push(path.relative(base, full).split(path.sep).join("/"));
    }
  }

  return out.sort();
}

test("retired Functions package artifacts stay absent", () => {
  for (const rel of retired) {
    assert.equal(
      fs.existsSync(path.join(repoRoot, rel)),
      false,
      `${rel} must stay retired`,
    );
  }
});

test("Functions source directory does not embed knowledge-base or backup source", () => {
  const files = walk(functionsRoot);

  const forbidden = files.filter((rel) => {
    const lower = rel.toLowerCase();
    const base = path.posix.basename(rel);

    return (
      lower.endsWith(".md") ||
      lower.endsWith(".backup.js") ||
      base === "KNOWLEDGE_BASE_MANIFEST.json"
    );
  });

  assert.deepEqual(
    forbidden,
    [],
    `functions/ contains package-hygiene violations: ${forbidden.join(", ")}`,
  );
});

test("Functions runtime entry contract remains index.js on Node 22", () => {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(functionsRoot, "package.json"), "utf8"),
  );

  assert.equal(pkg.main, "index.js");
  assert.equal(String(pkg.engines?.node), "22");
  assert.equal(fs.existsSync(path.join(functionsRoot, "index.js")), true);
});

test("Firebase Functions source remains functions and canonical docs remain outside package", () => {
  const firebase = JSON.parse(
    fs.readFileSync(path.join(repoRoot, "firebase.json"), "utf8"),
  );

  assert.equal(firebase.functions?.[0]?.source, "functions");

  for (const rel of [
    "docs/AI_START_HERE.md",
    "docs/CURRENT_STATE.md",
    "docs/DEPLOYMENT.md",
    "docs/SYSTEM_SOURCE_MAP.md",
  ]) {
    assert.equal(
      fs.existsSync(path.join(repoRoot, rel)),
      true,
      `${rel} canonical doc must exist`,
    );
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");

const pointerMap = {
  "AI_START_HERE.md": "docs/AI_START_HERE.md",
  "ARCHITECTURE.md": "docs/ARCHITECTURE.md",
  "DATA_IDENTITY_RULES.md": "docs/DATA_IDENTITY_RULES.md",
  "DEPLOYMENT.md": "docs/DEPLOYMENT.md",
  "DEVELOPMENT_GUIDE.md": "docs/DEVELOPMENT_GUIDE.md",
  "SYSTEM_SOURCE_MAP.md": "docs/SYSTEM_SOURCE_MAP.md",
};

test("root duplicate knowledge-base files are compatibility pointers only", () => {
  for (const [rootFile, canonical] of Object.entries(pointerMap)) {
    const filePath = path.join(repoRoot, rootFile);
    const canonicalPath = path.join(repoRoot, canonical);

    assert.equal(fs.existsSync(filePath), true, `${rootFile} must remain as compatibility pointer`);
    assert.equal(fs.existsSync(canonicalPath), true, `${canonical} must exist`);

    const content = fs.readFileSync(filePath, "utf8");
    assert.match(content, /Compatibility pointer only/);
    assert.ok(content.includes(`\`${canonical}\``));
    assert.ok(content.length < 1200, `${rootFile} must not become a second full knowledge base`);
  }
});

test("double-extension source map is retired", () => {
  assert.equal(
    fs.existsSync(path.join(repoRoot, "SYSTEM_SOURCE_MAP.md.md")),
    false,
    "SYSTEM_SOURCE_MAP.md.md must stay retired",
  );
});

test("root README points to canonical docs", () => {
  const readme = fs.readFileSync(path.join(repoRoot, "README.md"), "utf8");

  for (const required of [
    "docs/PROJECT_OPERATING_RULES.md",
    "docs/AI_START_HERE.md",
    "docs/CURRENT_STATE.md",
    "docs/README.md",
    "docs/SYSTEM_SOURCE_MAP.md",
  ]) {
    assert.ok(readme.includes(required), `README must reference ${required}`);
  }

  assert.match(readme, /Repository landing page/);
});

test("canonical docs index records root pointer governance", () => {
  const canonicalReadme = fs.readFileSync(path.join(repoRoot, "docs/README.md"), "utf8");
  const sourceMap = fs.readFileSync(path.join(repoRoot, "docs/SYSTEM_SOURCE_MAP.md"), "utf8");

  assert.ok(canonicalReadme.includes("最後整併更新：2026-09-15"));
  assert.ok(canonicalReadme.includes("CURRENT_APP_VERSION = 3.6.0"));
  assert.ok(canonicalReadme.includes("# 4. Canonical / Compatibility Pointer 邊界"));
  assert.ok(canonicalReadme.includes("這些 root 檔案只能是 pointer"));
  assert.ok(sourceMap.includes("Repository Canonical Documentation Entry Override — 2026-09-15"));
});

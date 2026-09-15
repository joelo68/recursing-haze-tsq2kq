import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");

const retiredRootArtifacts = [
  "KNOWLEDGE_BASE_MANIFEST.json",
  "MANIFEST_SHA256.json",
  "README_DEPLOY.md",
  "README_DEPLOYMENT.md",
  "README_UPDATE.md",
  "README_v3.5.1.md",
  "VALIDATION.txt",
  "tree.txt",
  "device-approval-v1.patch",
  "device-approval-v3.5.1-live-badge.patch",
  "device-review-three-levels.patch",
];

test("historical one-time delivery artifacts stay retired from repository root", () => {
  for (const rel of retiredRootArtifacts) {
    assert.equal(
      fs.existsSync(path.join(repoRoot, rel)),
      false,
      `${rel} must stay retired from live root`,
    );
  }
});

test("canonical root compatibility pointers remain present", () => {
  for (const rel of [
    "AI_START_HERE.md",
    "ARCHITECTURE.md",
    "DATA_IDENTITY_RULES.md",
    "DEPLOYMENT.md",
    "DEVELOPMENT_GUIDE.md",
    "SYSTEM_SOURCE_MAP.md",
    "README.md",
  ]) {
    assert.equal(
      fs.existsSync(path.join(repoRoot, rel)),
      true,
      `${rel} must remain`,
    );
  }
});

test("canonical documentation remains under docs", () => {
  for (const rel of [
    "docs/PROJECT_OPERATING_RULES.md",
    "docs/AI_START_HERE.md",
    "docs/CURRENT_STATE.md",
    "docs/README.md",
    "docs/SYSTEM_SOURCE_MAP.md",
    "docs/DEPLOYMENT.md",
  ]) {
    assert.equal(
      fs.existsSync(path.join(repoRoot, rel)),
      true,
      `${rel} canonical doc must exist`,
    );
  }
});

test("docs index records root historical artifact retirement governance", () => {
  const readme = fs.readFileSync(
    path.join(repoRoot, "docs/README.md"),
    "utf8",
  );

  assert.ok(readme.includes("Repository root 不保存一次性交付 artifacts"));
  assert.ok(readme.includes("應由 Git history 保存"));
  assert.ok(readme.includes("已失效 patch / delivery patch"));
});

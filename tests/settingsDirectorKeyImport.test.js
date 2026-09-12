import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const settings = fs.readFileSync(path.join(ROOT, "src/components/SettingsView.jsx"), "utf8");

test("director password-reset Key icon is imported from lucide-react before SettingsView renders it", () => {
  const lucideImport = settings.match(/import\s*\{([\s\S]*?)\}\s*from\s*"lucide-react";/);
  assert.ok(lucideImport, "lucide-react named import must exist");
  assert.match(lucideImport[1], /(?:^|[,\s])Key(?:[,\s]|$)/);
  assert.match(settings, /<Key\s+size=\{14\}/);
});

test("director-account tab remains present while the runtime icon regression is fixed", () => {
  assert.match(settings, /id:\s*"director-account",\s*label:\s*"高階主管帳號"/);
  assert.match(settings, /handleResetDirectorPassword/);
});

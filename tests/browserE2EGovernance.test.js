import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

test("P1-B browser workflow is read-only and cannot deploy production", () => {
  const workflow = read(".github/workflows/browser-e2e.yml");

  assert.match(workflow, /name: Critical Browser E2E/);
  assert.match(workflow, /permissions:\s*\n\s*contents: read/);
  assert.match(workflow, /node-version: "22"/);
  assert.match(workflow, /playwright install --with-deps chromium/);
  assert.match(workflow, /npm run e2e:browser/);

  assert.doesNotMatch(workflow, /firebase\s+deploy/);
  assert.doesNotMatch(workflow, /npm\s+run\s+deploy/);
  assert.doesNotMatch(workflow, /gh-pages\s+-d/);
  assert.doesNotMatch(workflow, /contents:\s*write/);
  assert.doesNotMatch(workflow, /secrets\./);
});

test("P1-B uses pinned Playwright and source-controlled browser commands", () => {
  const pkg = JSON.parse(read("package.json"));

  assert.equal(pkg.devDependencies?.["@playwright/test"], "1.63.0");
  assert.equal(pkg.scripts?.["e2e:serve"], "vite --config vite.e2e.config.js --host 127.0.0.1 --port 4174 --strictPort");
  assert.equal(pkg.scripts?.["e2e:build"], "vite build --config vite.e2e.config.js");
  assert.equal(pkg.scripts?.["e2e:browser"], "playwright test -c playwright.e2e.config.js");
  assert.equal(pkg.scripts?.["e2e:browser:list"], "playwright test -c playwright.e2e.config.js --list");
});

test("P1-B harness imports actual production browser components", () => {
  const harness = read("e2e/main.jsx");

  for (const source of [
    "../src/components/LoginView",
    "../src/components/DeviceApprovalGate",
    "../src/components/Navigation",
    "../src/components/SharedUI",
    "../src/AppContext",
  ]) {
    assert.match(harness, new RegExp(source.replaceAll("/", "\\/")));
  }

  assert.match(harness, /LoginView/);
  assert.match(harness, /Sidebar/);
  assert.match(harness, /MobileTopNav/);
  assert.match(harness, /AsyncActionButton/);
  assert.match(harness, /DeviceApprovalGate/);
});

test("P1-B browser fixture cannot call Production or external services", () => {
  const files = [
    "playwright.e2e.config.js",
    "vite.e2e.config.js",
    "e2e/index.html",
    "e2e/main.jsx",
    "e2e/tests/critical-browser.spec.js",
    ".github/workflows/browser-e2e.yml",
  ];

  const combined = files.map(read).join("\n");

  for (const forbidden of [
    "cloudfunctions.net",
    "run.app",
    "firestore.googleapis.com",
    "identitytoolkit.googleapis.com",
    "firebaseio.com",
    "joelo68.github.io",
  ]) {
    assert.equal(
      combined.includes(forbidden),
      false,
      `P1-B E2E source must not contain Production/external host: ${forbidden}`,
    );
  }

  assert.match(read("playwright.e2e.config.js"), /http:\/\/127\.0\.0\.1:4174/);
  assert.match(read("e2e/tests/critical-browser.spec.js"), /externalRequests/);
});

test("P1-B covers login, permission navigation, save duplicate guard and device security gate", () => {
  const spec = read("e2e/tests/critical-browser.spec.js");

  assert.match(spec, /critical login: sanitized directory selection/);
  assert.match(spec, /critical login: rejected credential/);
  assert.match(spec, /critical login: initial password/);
  assert.match(spec, /critical permissions\/navigation/);
  assert.match(spec, /critical save: async action/);
  assert.match(spec, /critical security: device approval gate/);
});

test("P1-B does not modify application version ownership", () => {
  assert.match(
    read("src/App.jsx"),
    /const CURRENT_APP_VERSION = "3\.6\.0";/,
  );
});

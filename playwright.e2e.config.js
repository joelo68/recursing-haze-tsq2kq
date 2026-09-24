import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e/tests",
  timeout: 20_000,
  expect: {
    timeout: 7_000,
  },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["line"]] : [["list"]],
  use: {
    baseURL: "http://127.0.0.1:4174",
    browserName: "chromium",
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    serviceWorkers: "block",
  },
  webServer: {
    command: "npm run e2e:serve",
    url: "http://127.0.0.1:4174/e2e/index.html",
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
  },
});

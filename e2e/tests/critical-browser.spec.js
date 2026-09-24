import { test, expect } from "@playwright/test";

const externalRequests = [];

test.beforeEach(async ({ page }) => {
  externalRequests.length = 0;
  page.on("request", (request) => {
    const url = request.url();
    if (
      url.startsWith("http://127.0.0.1:4174/") ||
      url.startsWith("data:") ||
      url.startsWith("blob:")
    ) {
      return;
    }
    externalRequests.push(url);
  });
});

test.afterEach(async () => {
  expect(externalRequests, "Browser E2E must never contact Production or external services").toEqual([]);
});

async function openDirectorLogin(page) {
  await page.goto("/e2e/index.html?case=login");
  await page.getByRole("button", { name: "CYJ", exact: true }).click();
  await expect(page.getByRole("heading", { name: "CYJ 營運管理" })).toBeVisible();

  const directorSelect = page.locator("select").first();
  await expect(directorSelect).toBeVisible();
  await directorSelect.selectOption("director-e2e");
  return directorSelect;
}

test("critical login: sanitized directory selection reaches the login callback", async ({ page }) => {
  await openDirectorLogin(page);

  await page.getByPlaceholder("輸入密碼或最高管理金鑰").fill("e2e-safe-pass");
  await page.getByRole("button", { name: "登入", exact: true }).click();

  await expect(page.getByTestId("login-result")).toHaveText("LOGIN_OK:director:director-e2e");
});

test("critical login: rejected credential remains on login and shows a clear error", async ({ page }) => {
  await openDirectorLogin(page);

  await page.getByPlaceholder("輸入密碼或最高管理金鑰").fill("wrong-pass");
  await page.getByRole("button", { name: "登入", exact: true }).click();

  await expect(page.getByText("密碼錯誤", { exact: true })).toBeVisible();
  await expect(page.getByTestId("login-result")).toHaveText("REJECTED:director:director-e2e");
});

test("critical login: initial password cannot enter the system before safety update", async ({ page }) => {
  await openDirectorLogin(page);

  await page.getByPlaceholder("輸入密碼或最高管理金鑰").fill("16500");
  await page.getByRole("button", { name: "登入", exact: true }).click();

  await expect(page.getByRole("heading", { name: "首次安全更新" })).toBeVisible();
  await expect(page.getByPlaceholder("設定新密碼")).toBeVisible();
  await expect(page.getByTestId("login-result")).toHaveText("NOT_CALLED");
});

test("critical permissions/navigation: manager sees only allowed modules on desktop and mobile", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/e2e/index.html?case=navigation");

  await expect(page.getByRole("button", { name: /營運總覽/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /年度分析/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /系統設定/ })).toHaveCount(0);

  await page.getByRole("button", { name: /年度分析/ }).click();
  await expect(page.getByTestId("active-view")).toHaveText("ACTIVE:annual");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();

  await expect(page.getByRole("button", { name: /營運總覽/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /年度分析/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /系統設定/ })).toHaveCount(0);
});

test("critical save: async action shows progress and blocks duplicate execution", async ({ page }) => {
  await page.goto("/e2e/index.html?case=save");

  const button = page.getByTestId("save-action");
  await button.click();

  await expect(button).toHaveAttribute("aria-busy", "true");
  await expect(button).toBeDisabled();
  await expect(button).toContainText("儲存中…");

  await page.evaluate(() => {
    const element = document.querySelector('[data-testid="save-action"]');
    element?.click();
    element?.click();
  });

  await expect(page.getByTestId("save-status")).toHaveText("STATUS:SAVED");
  await expect(page.getByTestId("save-run-count")).toHaveText("COUNT:1");
});

test("critical security: device approval gate blocks normal work and can return to login", async ({ page }) => {
  await page.goto("/e2e/index.html?case=security");

  await expect(page.getByRole("heading", { name: "這台裝置需要先確認" })).toBeVisible();
  await expect(page.getByText("新裝置確認碼", { exact: true })).toBeVisible();
  await expect(page.getByText("123 456", { exact: true })).toBeVisible();
  await expect(page.getByTestId("security-state")).toHaveText("BLOCKED");

  await page.getByRole("button", { name: /返回登入/ }).click();
  await expect(page.getByTestId("security-result")).toHaveText("RETURNED");
});

test("critical observability: System Monitor shows bounded production health without external requests", async ({ page }) => {
  await page.goto("/e2e/index.html?case=health");

  await expect(page.getByRole("button", { name: "系統狀態", exact: true })).toBeVisible();
  await expect(page.getByText("整體運作正常", { exact: true })).toBeVisible();
  await expect(page.getByText("上月已確認", { exact: true })).toBeVisible();
  await expect(page.getByText("0 筆待確認", { exact: true })).toBeVisible();
  await expect(page.getByText("今天 12 次", { exact: true })).toBeVisible();
  await expect(page.getByText("單次檢查設計上限為 21 筆文件讀取。", { exact: false })).toBeVisible();

  await page.getByRole("button", { name: /重新檢查/ }).click();
  await expect(page.getByText("整體運作正常", { exact: true })).toBeVisible();
});

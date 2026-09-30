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
  expect(
    externalRequests,
    "Trainer therapist-account E2E must never contact Production or external services"
  ).toEqual([]);
});

test("trainer therapist-account incident: page becomes ready and allowed actions are exposed without secret/delete controls", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/e2e/index.html?case=trainer-therapist");

  const menu = page.getByRole("button", { name: /管師帳號/ });
  await expect(menu).toBeVisible();
  await menu.click();

  await expect(page.getByTestId("trainer-therapist-ready")).toHaveText("READY");
  await expect(page.getByText("管師帳號資料同步中…", { exact: true })).toHaveCount(0);

  await expect(page.getByRole("button", { name: "新增", exact: true })).toBeVisible();

  await page.getByPlaceholder("搜尋姓名、店家或帳號...").fill("測試管理師");
  await expect(page.getByTitle("編輯")).toBeVisible();
  await page.getByTitle("編輯").click();

  await expect(page.getByRole("heading", { name: "人員資料", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "儲存修改", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "封存", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "重設登入密碼", exact: true })).toBeVisible();

  await expect(page.getByRole("button", { name: "查看目前密碼", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "永久刪除此帳號", exact: true })).toHaveCount(0);
  await expect(page.getByTitle("永久刪除")).toHaveCount(0);

  const nameInput = page.getByPlaceholder("請輸入姓名").first();
  await nameInput.fill("測試管理師更新");
  await page.getByRole("button", { name: "儲存修改", exact: true }).click();
  await expect(page.getByTestId("trainer-action-log")).toContainText("update");

  await page.getByPlaceholder("搜尋姓名、店家或帳號...").fill("測試管理師");
  await page.getByTitle("編輯").click();

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "重設登入密碼", exact: true }).click();
  await expect(page.getByTestId("trainer-action-log")).toContainText("reset_password");

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "封存", exact: true }).click();
  await expect(page.getByTestId("trainer-action-log")).toContainText("archive");

  await expect(page.getByRole("button", { name: "永久刪除此帳號", exact: true })).toHaveCount(0);
  await expect(page.getByTitle("永久刪除")).toHaveCount(0);
  await expect(page.getByTestId("trainer-action-log")).not.toContainText("delete");
  await expect(page.getByTestId("trainer-action-log")).not.toContainText("reveal_password");

  await page.getByRole("button", { name: "新增", exact: true }).click();
  await expect(page.getByRole("heading", { name: "新增管理師", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "確認新增", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "查看目前密碼", exact: true })).toHaveCount(0);
});

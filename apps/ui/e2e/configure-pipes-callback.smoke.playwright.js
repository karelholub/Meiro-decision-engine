import { test, expect } from "@playwright/test";

test("configure pipes callback enable and send test", async ({ page }) => {
  await page.goto("/settings/integrations/pipes-callback");

  await page.getByLabel("Enable callback delivery").check();
  await page.getByLabel("Callback URL").fill("https://example.com/callback");
  await page.getByRole("button", { name: "Save" }).click();

  await page.getByRole("button", { name: "Send Test Callback" }).click();
  await page.getByRole("button", { name: "Send" }).click();

  await expect(page.getByText("HTTP status:")).toBeVisible();
});

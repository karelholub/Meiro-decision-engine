import { test, expect } from "@playwright/test";

test("configure wbs test connection shows result panel", async ({ page }) => {
  await page.goto("/settings/wbs");

  await page.getByRole("button", { name: "Test Connection" }).click();
  await expect(page.getByText("WBS lookup test")).toBeVisible();
  await expect(page.getByText("Response snippet")).toBeVisible();
});

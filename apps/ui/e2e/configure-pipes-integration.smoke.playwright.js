import { test, expect } from "@playwright/test";

test("configure pipes integration fetch requirements and run evaluate", async ({ page }) => {
  await page.goto("/settings/integrations/pipes");

  await page.getByRole("button", { name: "Fetch" }).click();
  await expect(page.getByText("requirementsHash:")).toBeVisible();

  await page.getByRole("button", { name: "Fill tester with minimal skeleton" }).click();
  await page.getByRole("button", { name: "Run /v1/evaluate" }).click();

  await expect(page.getByText("Eligible:")).toBeVisible();
});

import { test, expect } from "@playwright/test";

test("configure wbs mapping run test and show three-panel output", async ({ page }) => {
  await page.goto("/settings/wbs-mapping");

  await page.getByRole("button", { name: "Test mapping" }).click();
  await expect(page.getByText("Test Mapping Output")).toBeVisible();
  await expect(page.getByText("Raw WBS response")).toBeVisible();
  await expect(page.getByText("Mapped profile")).toBeVisible();
  await expect(page.getByText("Warnings")).toBeVisible();
});

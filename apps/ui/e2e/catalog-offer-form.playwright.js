import { test, expect } from "@playwright/test";

test("create discount offer without touching JSON -> validate -> save -> activate", async ({ page }) => {
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  const offerKey = `E2E_FORM_OFFER_${suffix}`;

  await page.goto("/catalog/offers");

  await page.getByRole("button", { name: "New offer" }).click();
  await page.getByLabel("Key").fill(offerKey);
  await page.getByLabel("Name").fill(`Form Offer ${suffix}`);
  await page.getByLabel("Code").fill("FORM20");
  await page.getByLabel("Percent").fill("20");
  await page.getByLabel("Min Spend (optional)").fill("100");
  await page.getByLabel("New customers only").check();

  await page.getByRole("button", { name: "Validate" }).click();
  await expect(page.getByText("Validation passed")).toBeVisible();

  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText(new RegExp(`Saved offer ${offerKey} v1`))).toBeVisible();

  await page.getByRole("button", { name: "Validate" }).click();
  await expect(page.getByText("Validation passed")).toBeVisible();

  await page.getByRole("button", { name: "Activate" }).click();
  await expect(page.getByText(new RegExp(`Activated ${offerKey} v1`))).toBeVisible();
});

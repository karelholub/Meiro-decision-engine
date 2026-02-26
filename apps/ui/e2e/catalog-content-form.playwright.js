import { test, expect } from "@playwright/test";

test("create banner content block form-first -> preview -> save -> activate", async ({ page }) => {
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  const contentKey = `E2E_FORM_CONTENT_${suffix}`;

  await page.goto("/catalog/content");

  await page.getByRole("button", { name: "New content block" }).click();
  await page.getByLabel("Key").fill(contentKey);
  await page.getByLabel("Name").fill(`Form Content ${suffix}`);

  await page.getByLabel("Add locale (de, fr)").fill("de");
  await page.getByRole("button", { name: "Add locale" }).click();

  await page.getByRole("button", { name: "de" }).click();
  await page.getByLabel("title").fill("Hallo {{profile.first_name}}");
  await page.getByLabel("subtitle").fill("Nutze {{offer.code}} mit {{offer.percent}}%");
  await page.getByLabel("cta").fill("Jetzt");
  await page.getByLabel("image").fill("https://cdn.example.com/de.jpg");
  await page.getByLabel("deeplink").fill("app://deals");

  await page.getByRole("button", { name: "Add binding" }).click();
  await page.getByPlaceholder("offer").last().fill("profile");
  await page.getByPlaceholder("context.offer").last().fill("profile");

  await page.getByRole("button", { name: "Run preview" }).click();
  await expect(page.getByText("Preview generated")).toBeVisible();

  await page.getByRole("button", { name: "Validate" }).click();
  await expect(page.getByText("Validation passed")).toBeVisible();

  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText(new RegExp(`Saved content block ${contentKey} v1`))).toBeVisible();

  await page.getByRole("button", { name: "Validate" }).click();
  await expect(page.getByText("Validation passed")).toBeVisible();

  await page.getByRole("button", { name: "Activate" }).click();
  await expect(page.getByText(new RegExp(`Activated ${contentKey} v1`))).toBeVisible();
});

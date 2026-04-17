import { test, expect } from "@playwright/test";

const apiBase = process.env.E2E_API_BASE_URL || "http://localhost:3001";
const apiKey = process.env.E2E_API_KEY || "local-write-key";

test("decision wizard happy path", async ({ page, request }) => {
  const suffix = Date.now();
  const decisionKey = `wizard_decision_${suffix}`;
  const userEmail = `publisher.${suffix}@decisioning.local`;

  const loginResponse = await request.post(`${apiBase}/v1/auth/dev-login`, {
    headers: {
      "x-env": "DEV",
      "x-api-key": apiKey
    },
    data: {
      email: userEmail,
      profile: "publisher"
    }
  });
  expect(loginResponse.ok()).toBeTruthy();

  await page.addInitScript((email) => {
    window.localStorage.setItem(
      "decisioning_app_settings_v1",
      JSON.stringify({ decisionWizardMode: "enabled" })
    );
    window.localStorage.setItem("decisioning_user_email", email);
  }, userEmail);

  const createResponse = await request.post(`${apiBase}/v1/decisions`, {
    headers: {
      "x-env": "DEV",
      "x-api-key": apiKey
    },
    data: {
      key: decisionKey,
      name: `Wizard ${decisionKey}`,
      description: "wizard e2e"
    }
  });

  expect(createResponse.ok()).toBeTruthy();
  const created = await createResponse.json();

  await page.goto(`/decisions/${created.decisionId}/edit?tab=basic`);

  await page.getByRole("button", { name: "Skip templates" }).click();
  await page.getByRole("button", { name: "Next step" }).click();
  await page.getByRole("button", { name: "consent_marketing = true" }).click();
  await page.getByRole("button", { name: "Next step" }).click();

  await page.getByLabel("Action type").first().selectOption("message");
  await page.getByLabel("Placement").first().fill("home_top");
  await page.getByLabel("Template ID").first().fill("banner_v1");
  await page.getByRole("button", { name: "Next step" }).click();

  await page.getByRole("button", { name: "Standard messaging safety" }).click();
  await page.getByRole("button", { name: "Next step" }).click();
  await page.getByRole("button", { name: "Next step" }).click();

  await page.getByRole("button", { name: "Run eligible test" }).click();
  await page.getByRole("button", { name: "Run ineligible test" }).click();
  await expect(page.getByText("Assertion: matched rule + actionType != noop")).toBeVisible();
  await expect(page.getByText("Assertion: default/noop outcome")).toBeVisible();

  await page.getByRole("button", { name: "Validate" }).first().click();
  await expect(page.getByText("Validation passed.")).toBeVisible();

  await page.getByLabel(`I confirmed the target environment (DEV)`).check();
  await page.getByLabel(new RegExp(`I confirmed the key/version \\(${decisionKey} v1\\)`)).check();

  await page.getByRole("button", { name: /^Activate$/ }).nth(1).click();
  await page.getByLabel("Activation note").fill("E2E activation note");
  await page.getByLabel("Use emergency approval override").check();
  await page.getByLabel("Override reason").fill("E2E activation override for draft-only happy path");
  await page.getByRole("button", { name: "Activate draft" }).click();
  await expect(page.getByText("Draft activated.")).toBeVisible();
});

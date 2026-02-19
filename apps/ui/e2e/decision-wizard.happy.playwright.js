const { test, expect } = require("@playwright/test");

const apiBase = process.env.E2E_API_BASE_URL || "http://localhost:3001";

test("decision wizard happy path", async ({ page, request }) => {
  const suffix = Date.now();
  const decisionKey = `wizard_decision_${suffix}`;

  const createResponse = await request.post(`${apiBase}/v1/decisions`, {
    headers: {
      "x-env": "DEV"
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

  await page.getByRole("button", { name: "Eligibility" }).click();

  await page.getByRole("button", { name: "Add condition" }).click();
  await page.getByRole("button", { name: "Add condition" }).click();
  await page.getByRole("button", { name: "Add condition" }).click();

  const technicalFields = page.getByLabel("Technical field");
  await technicalFields.nth(0).fill("purchase_count");
  await technicalFields.nth(1).fill("email");
  await technicalFields.nth(2).fill("consent_marketing");

  const operators = page.getByLabel("Operator");
  await operators.nth(0).selectOption("eq");
  await operators.nth(1).selectOption("exists");
  await operators.nth(2).selectOption("eq");

  const values = page.getByLabel("Value");
  await values.nth(0).fill("0");
  await values.nth(1).fill("true");

  await page.getByRole("button", { name: "Rules" }).click();
  await page.getByLabel("Action type").first().selectOption("message");
  await page.getByLabel("Placement").first().fill("home_top");
  await page.getByLabel("Template ID").first().fill("banner_v1");

  await page.getByRole("button", { name: "Validate" }).first().click();
  await expect(page.getByText("Validation passed.")).toBeVisible();

  await page.getByRole("button", { name: "Save" }).first().click();
  await expect(page.getByText("Draft saved.")).toBeVisible();

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Activate" }).first().click();
  await expect(page.getByText("Draft activated.")).toBeVisible();

  await page.getByRole("button", { name: "Test & Activate" }).click();
  await page.getByRole("button", { name: "Run simulation" }).click();

  await expect(page.getByText("Action:").first()).toContainText("message");
});

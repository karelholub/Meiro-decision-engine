import { test, expect } from "@playwright/test";
import { apiBase, expectJson, uniqueSuffix, writeHeaders } from "./helpers/api-helpers.js";

test("catalog content block can be activated and resolved in decision simulation", async ({ page, request }) => {
  const suffix = uniqueSuffix();
  const contentKey = `CATALOG_E2E_CONTENT_${suffix}`;
  const decisionKey = `catalog_decision_${suffix}`;

  await page.addInitScript(() => {
    window.localStorage.setItem("decisioning_app_settings_v1", JSON.stringify({ decisionWizardMode: "enabled" }));
  });

  const contentCreate = await request.post(`${apiBase}/v1/catalog/content`, {
    headers: writeHeaders(),
    data: {
      key: contentKey,
      name: `Catalog Content ${suffix}`,
      status: "DRAFT",
      tags: ["inapp", "promo"],
      templateId: "banner_v1",
      schemaJson: {
        type: "object",
        required: ["title", "subtitle"],
        properties: {
          title: { type: "string" },
          subtitle: { type: "string" }
        }
      },
      localesJson: {
        en: {
          title: "Catalog Winback",
          subtitle: "Static subtitle"
        }
      },
      tokenBindings: {}
    }
  });
  await expectJson(contentCreate, "create catalog content");

  const activateContent = await request.post(`${apiBase}/v1/catalog/content/${contentKey}/activate`, {
    headers: writeHeaders(),
    data: {}
  });
  await expectJson(activateContent, "activate catalog content");

  const createDecision = await request.post(`${apiBase}/v1/decisions`, {
    headers: writeHeaders(),
    data: {
      key: decisionKey,
      name: `Catalog Decision ${suffix}`,
      description: "catalog smoke"
    }
  });
  const created = await expectJson(createDecision, "create decision");

  await page.goto(`/decisions/${created.decisionId}/edit?tab=basic`);

  await page.getByRole("button", { name: "Rules" }).click();
  await page.getByLabel("Action type").first().selectOption("message");
  await page.getByLabel("Raw payload JSON").first().fill(
    JSON.stringify(
      {
        show: true,
        placement: "home_top",
        templateId: "banner_v1",
        payload: {},
        payloadRef: {
          contentKey
        }
      },
      null,
      2
    )
  );

  await page.getByRole("button", { name: "Save" }).first().click();
  await expect(page.getByText("Draft saved.")).toBeVisible();

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Activate" }).first().click();
  await expect(page.getByText("Draft activated.")).toBeVisible();

  await page.getByRole("button", { name: "Test & Activate" }).click();
  await page.getByRole("button", { name: "Run eligible test" }).click();

  await expect(page.getByText("Catalog Winback")).toBeVisible();
});

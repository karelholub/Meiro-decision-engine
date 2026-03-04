import { test, expect } from "@playwright/test";

const buildItem = (index) => ({
  id: `id-${index}`,
  environment: "DEV",
  key: `exp_${index}`,
  name: `Experiment ${index}`,
  version: 1,
  status: index % 3 === 0 ? "ACTIVE" : index % 3 === 1 ? "DRAFT" : "PAUSED",
  description: null,
  updatedAt: new Date(Date.now() - index * 1000 * 60).toISOString(),
  activatedAt: null,
  startAt: null,
  endAt: null,
  appKey: "web",
  placements: ["home_top"],
  channels: ["inapp"],
  holdoutPct: 5,
  variantsSummary: "A 50% / B 50%",
  activeVersion: index % 3 === 0 ? 1 : null,
  draftVersion: index % 3 === 1 ? 1 : null,
  hasDraft: index % 3 === 1
});

test("inventory supports scale and bulk pause + details/edit/save flow", async ({ page }) => {
  const items = Array.from({ length: 600 }).map((_, index) => buildItem(index + 1));

  await page.route("**/v1/me", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        user: { id: "u1", email: "admin@example.com", role: "ADMIN" },
        envPermissions: {
          DEV: ["experiment.read", "experiment.write", "experiment.activate", "experiment.archive", "promotion.create"],
          STAGE: [],
          PROD: []
        }
      })
    });
  });

  await page.route("**/v1/experiments?**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items, nextCursor: null })
    });
  });

  await page.route("**/v1/experiments/*/pause", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ item: null }) });
  });

  await page.route("**/v1/experiments/*/summary", async (route) => {
    const key = route.request().url().split("/v1/experiments/")[1].split("/")[0];
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        item: {
          key,
          name: "Experiment 1",
          status: "DRAFT",
          environment: "DEV",
          updatedAt: new Date().toISOString(),
          description: null,
          appKey: "web",
          placements: ["home_top"],
          channels: ["inapp"],
          variantsSummary: "A 50% / B 50%",
          holdoutPct: 5,
          startAt: null,
          endAt: null,
          activeVersion: null,
          draftVersion: 1,
          latestVersion: 1,
          versions: [{ id: "id-1", version: 1, status: "DRAFT", updatedAt: new Date().toISOString(), activatedAt: null }]
        }
      })
    });
  });

  await page.route("**/v1/experiments/key/*", async (route) => {
    const key = route.request().url().split("/v1/experiments/key/")[1];
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        item: {
          id: "id-1",
          environment: "DEV",
          key,
          version: 1,
          status: "DRAFT",
          name: "Experiment 1",
          description: null,
          updatedAt: new Date().toISOString(),
          activatedAt: null,
          startAt: null,
          endAt: null,
          appKey: "web",
          placements: ["home_top"],
          experimentJson: {
            schemaVersion: "experiment.v1",
            key,
            scope: { appKey: "web", placements: ["home_top"], channels: ["inapp"] },
            population: { eligibility: { audiencesAny: [], attributes: [] } },
            assignment: { unit: "profileId", salt: "salt", stickiness: { mode: "ttl", ttl_seconds: 86400 }, weights: "static" },
            variants: [
              { id: "A", weight: 50, treatment: { type: "inapp_message", contentKey: "c1" } },
              { id: "B", weight: 50, treatment: { type: "inapp_message", contentKey: "c2" } }
            ],
            holdout: { enabled: false, percentage: 0, behavior: "noop" },
            activation: {}
          }
        }
      })
    });
  });

  await page.route("**/v1/inapp/apps", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [{ id: "a1", key: "web", name: "Web", platforms: [] }] }) });
  });
  await page.route("**/v1/inapp/placements", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [{ id: "p1", key: "home_top", name: "Home Top", description: null, allowedTemplateKeys: [], defaultTtlSeconds: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), environment: "DEV" }] }) });
  });
  await page.route("**/v1/catalog/content?**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [] }) });
  });
  await page.route("**/v1/catalog/offers?**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [] }) });
  });

  await page.route("**/v1/experiments/id-1", async (route) => {
    if (route.request().method() === "PUT") {
      const body = await route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          item: {
            id: "id-1",
            environment: "DEV",
            key: "exp_1",
            version: 1,
            status: "DRAFT",
            name: body.name,
            description: body.description,
            updatedAt: new Date().toISOString(),
            activatedAt: null,
            startAt: null,
            endAt: null,
            appKey: "web",
            placements: ["home_top"],
            experimentJson: body.experimentJson
          },
          validation: { valid: true, errors: [], warnings: [] }
        })
      });
      return;
    }
    await route.fallback();
  });

  page.on("dialog", (dialog) => dialog.accept());

  await page.goto("/engage/experiments");
  await expect(page.getByText("Experiment Inventory")).toBeVisible();
  await expect(page.getByRole("row")).toHaveCount(601, { timeout: 10000 });

  await page.locator("tbody tr").first().locator("input[type='checkbox']").click();
  await page.getByRole("button", { name: "Bulk Pause" }).click();
  await expect(page.getByText(/pause completed/i)).toBeVisible();

  await page.getByRole("link", { name: "Experiment 1" }).click();
  await expect(page.getByText("Versions")).toBeVisible();
  await page.getByRole("link", { name: "Edit draft" }).first().click();
  await expect(page.getByText("Experiment Editor")).toBeVisible();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
  await page.getByRole("link", { name: "Back to details" }).click();
  await expect(page.getByText("Actions")).toBeVisible();
});

test("viewer RBAC hides activate", async ({ page }) => {
  await page.route("**/v1/me", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        user: { id: "u1", email: "viewer@example.com", role: "VIEWER" },
        envPermissions: {
          DEV: ["experiment.read"],
          STAGE: [],
          PROD: []
        }
      })
    });
  });

  await page.route("**/v1/experiments/*/summary", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        item: {
          key: "exp_1",
          name: "Experiment 1",
          status: "ACTIVE",
          environment: "DEV",
          updatedAt: new Date().toISOString(),
          description: null,
          appKey: "web",
          placements: ["home_top"],
          channels: ["inapp"],
          variantsSummary: "A 50% / B 50%",
          holdoutPct: 5,
          startAt: null,
          endAt: null,
          activeVersion: 1,
          draftVersion: null,
          latestVersion: 1,
          versions: []
        }
      })
    });
  });

  await page.route("**/v1/experiments/key/*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        item: {
          id: "id-1",
          environment: "DEV",
          key: "exp_1",
          version: 1,
          status: "ACTIVE",
          name: "Experiment 1",
          description: null,
          updatedAt: new Date().toISOString(),
          activatedAt: new Date().toISOString(),
          startAt: null,
          endAt: null,
          appKey: "web",
          placements: ["home_top"],
          experimentJson: {
            schemaVersion: "experiment.v1",
            key: "exp_1",
            scope: { appKey: "web", placements: ["home_top"], channels: ["inapp"] },
            population: { eligibility: { audiencesAny: [], attributes: [] } },
            assignment: { unit: "profileId", salt: "salt", stickiness: { mode: "ttl", ttl_seconds: 86400 }, weights: "static" },
            variants: [
              { id: "A", weight: 50, treatment: { type: "inapp_message", contentKey: "c1" } },
              { id: "B", weight: 50, treatment: { type: "inapp_message", contentKey: "c2" } }
            ],
            holdout: { enabled: false, percentage: 0, behavior: "noop" },
            activation: {}
          }
        }
      })
    });
  });

  await page.goto("/engage/experiments/exp_1");
  await expect(page.getByText("Actions")).toBeVisible();
  await expect(page.getByRole("button", { name: "Activate" })).toHaveCount(0);
});

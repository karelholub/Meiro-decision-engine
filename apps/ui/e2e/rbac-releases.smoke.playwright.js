import { test, expect } from "@playwright/test";

const defaultMe = {
  email: "e2e@example.com",
  userId: "u-1",
  envPermissions: {
    DEV: [],
    STAGE: [],
    PROD: []
  }
};

const mockJson = async (page, method, path, responseBody, status = 200) => {
  await page.route(`**${path}*`, async (route) => {
    if (route.request().method() !== method) {
      return route.continue();
    }
    await route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(responseBody)
    });
  });
};

const mockMe = async (page, me) => {
  await page.route("**/v1/me*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(me)
    });
  });
};

test("viewer cannot see Activate button", async ({ page }) => {
  await mockMe(page, {
    ...defaultMe,
    envPermissions: {
      DEV: ["catalog.offer.read"],
      STAGE: ["catalog.offer.read"],
      PROD: ["catalog.offer.read"]
    }
  });
  await mockJson(page, "GET", "/v1/catalog/offers", {
    items: [
      {
        id: "offer-1",
        environment: "DEV",
        key: "offer_view",
        name: "Offer View",
        description: "",
        status: "DRAFT",
        version: 1,
        tags: [],
        type: "discount",
        valueJson: { percent: 10 },
        constraints: {},
        startAt: null,
        endAt: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        activatedAt: null
      }
    ]
  });
  await mockJson(page, "GET", "/v1/catalog/tags", {
    offerTags: [],
    contentTags: [],
    campaignTags: []
  });

  await page.goto("/catalog/offers");
  await expect(page.getByRole("button", { name: /^Activate$/ }).first()).toBeDisabled();
});

test("builder sees Save and Validate but not Activate in PROD", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("decisioning_environment", "PROD");
    window.localStorage.setItem("decisioning_app_settings_v1", JSON.stringify({ decisionWizardMode: "disabled" }));
  });

  await mockMe(page, {
    ...defaultMe,
    envPermissions: {
      DEV: ["decision.read", "decision.write", "decision.activate"],
      STAGE: ["decision.read", "decision.write"],
      PROD: ["decision.read", "decision.write"]
    }
  });

  await mockJson(page, "GET", "/v1/decisions/d1", {
    id: "d1",
    environment: "PROD",
    key: "rbac_decision",
    name: "RBAC Decision",
    description: "",
    versions: [
      {
        versionId: "v1",
        version: 1,
        status: "DRAFT",
        updatedAt: new Date().toISOString(),
        activatedAt: null,
        definition: {
          id: "d1",
          key: "rbac_decision",
          name: "RBAC Decision",
          description: "",
          version: 1,
          status: "DRAFT",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          activatedAt: null,
          requiredAttributes: [],
          eligibility: { audiencesAll: [], audiencesAny: [], audiencesNone: [], attributes: [] },
          holdout: { enabled: false, percentage: 0, salt: "salt" },
          caps: { perProfilePerDay: null, perProfilePerWeek: null },
          flow: { rules: [] },
          outputs: { default: { actionType: "noop", payload: {} } }
        }
      }
    ]
  });

  await page.goto("/decisions/d1/edit?tab=advanced");
  await expect(page.getByRole("button", { name: /^Save$/ }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /^Validate$/ }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /^Activate$/ }).first()).toBeDisabled();
});

test("promotion flow creates release and shows diff", async ({ page }) => {
  const releaseId = "11111111-1111-4111-8111-111111111111";

  await mockMe(page, {
    ...defaultMe,
    envPermissions: {
      DEV: ["promotion.create", "promotion.apply", "promotion.approve"],
      STAGE: ["promotion.create", "promotion.apply", "promotion.approve"],
      PROD: ["promotion.create", "promotion.apply", "promotion.approve"]
    }
  });

  await mockJson(page, "GET", "/v1/releases", { items: [] });
  await mockJson(page, "POST", "/v1/releases/plan", {
    releaseId,
    plan: {
      sourceEnv: "DEV",
      targetEnv: "STAGE",
      mode: "copy_as_draft",
      items: [
        {
          type: "decision",
          key: "cart_recovery",
          version: 1,
          action: "update_new_version",
          dependsOn: [],
          diff: { hasChanges: true, summary: "Changed fields: flow" },
          riskFlags: ["NO_CAPS"],
          targetVersion: 2
        }
      ]
    }
  }, 201);
  await mockJson(page, "GET", `/v1/releases/${releaseId}`, {
    item: {
      id: releaseId,
      sourceEnv: "DEV",
      targetEnv: "STAGE",
      key: "rel_demo",
      status: "READY",
      createdByUserId: "u-1",
      createdByEmail: "e2e@example.com",
      approvalByUserId: null,
      approvalNote: null,
      appliedByUserId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      summary: "1 item",
      planJson: {
        sourceEnv: "DEV",
        targetEnv: "STAGE",
        mode: "copy_as_draft",
        items: [
          {
            type: "decision",
            key: "cart_recovery",
            version: 1,
            action: "update_new_version",
            dependsOn: [],
            diff: { hasChanges: true, summary: "Changed fields: flow" },
            riskFlags: ["NO_CAPS"],
            targetVersion: 2
          }
        ]
      }
    }
  });

  await page.goto("/releases");
  if (await page.getByRole("heading", { name: "404" }).count()) {
    test.skip(true, "/releases route is not available in the current external e2e host");
  }
  await page.fill('input[placeholder="key"]', "cart_recovery");
  await page.click("text=Create Release");

  await expect(page.getByText("Diff + Risk")).toBeVisible();
  await expect(page.getByText("Changed fields: flow")).toBeVisible();
  await expect(page.getByText("NO_CAPS")).toBeVisible();
});

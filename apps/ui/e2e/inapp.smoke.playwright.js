import { test, expect } from "@playwright/test";

const apiBase = process.env.E2E_API_BASE_URL || "http://localhost:3001";
const apiKey = process.env.E2E_API_KEY || "local-write-key";

test("create campaign -> activate -> simulate -> show=true", async ({ page, request }) => {
  const suffix = Date.now();
  const campaignKey = `e2e_home_top_${suffix}`;

  const createResponse = await request.post(`${apiBase}/v1/inapp/campaigns`, {
    headers: {
      "x-env": "DEV",
      "x-api-key": apiKey
    },
    data: {
      key: campaignKey,
      name: `E2E ${campaignKey}`,
      appKey: "meiro_store",
      placementKey: "home_top",
      templateKey: "banner_v1",
      status: "DRAFT",
      priority: 99,
      ttlSeconds: 3600,
      holdoutEnabled: false,
      holdoutPercentage: 0,
      holdoutSalt: `${campaignKey}-salt`,
      variants: [
        {
          variantKey: "A",
          weight: 100,
          contentJson: {
            title: "Hey {{first_name}}",
            subtitle: "RFM {{rfm}}",
            cta: "Open",
            image: "https://cdn.example.com/e2e.jpg",
            deeplink: "app://home"
          }
        }
      ],
      tokenBindingsJson: {
        first_name: "mx_first_name_last|takeFirst",
        rfm: "web_rfm|takeFirst"
      }
    }
  });

  expect(createResponse.ok()).toBeTruthy();
  const created = await createResponse.json();

  const activateResponse = await request.post(`${apiBase}/v1/inapp/campaigns/${created.item.id}/activate`, {
    headers: {
      "x-env": "DEV",
      "x-api-key": apiKey
    }
  });
  expect(activateResponse.ok()).toBeTruthy();

  await page.goto("/simulate");
  await page.getByLabel("Simulator mode").selectOption("inapp");
  await page.getByLabel("App Key").fill("meiro_store");
  await page.getByLabel("Placement").fill("home_top");
  await page.getByLabel("Lookup mode").selectOption("profileId");
  await page.getByLabel("profileId").last().fill("p-1001");
  await page.getByRole("button", { name: "Run" }).click();

  await expect(page.getByText(/Show:\s*true/).first()).toBeVisible();
});

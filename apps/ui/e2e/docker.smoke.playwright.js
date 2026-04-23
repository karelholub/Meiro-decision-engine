import { expect, test } from "@playwright/test";

const browserApiBase = process.env.E2E_BROWSER_API_BASE_URL || "http://localhost:3001";
const apiBase = process.env.E2E_API_BASE_URL || browserApiBase;
const uiBase = process.env.E2E_UI_BASE_URL || "http://localhost:3000";

const waitForOk = async (request, url) => {
  let lastError;

  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await request.get(url, { timeout: 1000 });
      if (response.ok()) {
        return;
      }
      lastError = new Error(`${url} returned ${response.status()}`);
    } catch (error) {
      lastError = error;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 500);
    });
  }

  throw lastError;
};

test("docker compose frontend smoke", async ({ page, request }) => {
  await page.route(`${browserApiBase}/**`, async (route) => {
    const { pathname } = new URL(route.request().url());
    let body = {};

    if (pathname === "/health") {
      body = {
        status: "ok",
        timestamp: new Date().toISOString(),
        runtime: { role: "all", workers: {} }
      };
    } else if (pathname.includes("/cache/stats")) {
      body = {
        redisEnabled: true,
        hits: 0,
        misses: 0,
        hitRate: 1,
        fallbackCount: 0,
        staleServedCount: 0
      };
    } else if (pathname.includes("/reports/overview")) {
      body = { impressions: 0, clicks: 0, ctr: 0 };
    } else {
      body = { items: [], total: 0, page: 1, limit: 20 };
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body)
    });
  });

  await waitForOk(request, `${apiBase}/health`);
  await waitForOk(request, uiBase);

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Operational Heartbeat" })).toBeVisible();
  await expect(page.getByText("API Health")).toBeVisible();
});

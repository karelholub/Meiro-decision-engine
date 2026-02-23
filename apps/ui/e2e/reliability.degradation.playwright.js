import { test, expect } from "@playwright/test";
import { apiBase, getJson, postJson, putJson, readHeaders, writeHeaders } from "./helpers/api-helpers.js";

test("reliability flow: runtime defaults, fallback behavior, debug latency", async ({ page, request }) => {
  test.setTimeout(120000);

  const before = await getJson(request, "/v1/settings/runtime", "load runtime settings (before)", readHeaders());
  const restoreOverride = before.override;

  const updatedSettings = {
    ...before.effective,
    decisionDefaults: {
      ...before.effective.decisionDefaults,
      timeoutMs: 150,
      wbsTimeoutMs: 90,
      staleTtlSeconds: 2400
    },
    inappV2: {
      ...before.effective.inappV2,
      wbsTimeoutMs: 60,
      staleTtlSeconds: 2400
    }
  };

  await putJson(
    request,
    "/v1/settings/runtime",
    "save runtime settings",
    { settings: updatedSettings },
    writeHeaders()
  );

  const afterSet = await getJson(request, "/v1/settings/runtime", "load runtime settings (after set)", readHeaders());
  expect(afterSet.effective.decisionDefaults.timeoutMs).toBe(150);
  expect(afterSet.effective.inappV2.wbsTimeoutMs).toBe(60);

  // Simulate dependency degradation via profile fetch failure.
  const fallbackResponse = await postJson(
    request,
    "/v2/inapp/decide",
    "inapp fallback request",
    {
      appKey: "meiro_store",
      placement: "home_top",
      profileId: "p-does-not-exist",
      context: {
        locale: "en-US",
        deviceType: "ios"
      }
    },
    readHeaders()
  );
  expect(fallbackResponse.show).toBe(false);
  expect(typeof fallbackResponse.debug?.fallbackReason).toBe("string");
  expect(fallbackResponse.debug?.latencyMs?.total).toBeLessThan(1000);

  // Healthy request should still return deterministic debug envelope.
  const healthyResponse = await postJson(
    request,
    "/v2/inapp/decide",
    "inapp healthy request",
    {
      appKey: "meiro_store",
      placement: "home_top",
      profileId: "p-1001",
      context: {
        locale: "en-US",
        deviceType: "ios"
      }
    },
    readHeaders()
  );
  expect(typeof healthyResponse.debug?.cache?.hit).toBe("boolean");
  expect(typeof healthyResponse.debug?.cache?.servedStale).toBe("boolean");
  expect(healthyResponse.debug?.latencyMs?.total).toBeGreaterThanOrEqual(0);

  if (restoreOverride) {
    await putJson(
      request,
      "/v1/settings/runtime",
      "restore runtime override",
      { settings: restoreOverride },
      writeHeaders()
    );
  } else {
    const resetResponse = await request.delete(`${apiBase}/v1/settings/runtime`, {
      headers: writeHeaders()
    });
    expect(resetResponse.ok()).toBeTruthy();
  }

  const afterRestore = await getJson(request, "/v1/settings/runtime", "load runtime settings (after restore)", readHeaders());
  expect(afterRestore.effective).toEqual(before.effective);

  await page.goto("/settings/app");
  await expect(page.getByRole("heading", { name: "Runtime Defaults (DEV)" })).toBeVisible();
  await expect(page.getByText("Decision timeout ms")).toBeVisible();
});

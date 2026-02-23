import { createHash } from "node:crypto";
import { test, expect } from "@playwright/test";
import { apiBase, getJson, postJson, putJson, readHeaders, uniqueSuffix, writeHeaders } from "./helpers/api-helpers.js";

const profiles = ["p-1001", "p-1002", "p-1003"];

const bucket = (seed) => {
  const digest = createHash("sha256").update(seed).digest("hex").slice(0, 8);
  return Number.parseInt(digest, 16) % 100;
};

const pickSaltForMixedHoldout = (campaignKey, holdoutPercentage) => {
  for (let index = 1; index <= 10000; index += 1) {
    const salt = `salt-${index}`;
    const decisions = profiles.map((profileId) => {
      const b = bucket(`${profileId}:${campaignKey}:${salt}`);
      return b >= holdoutPercentage;
    });
    if (decisions.some(Boolean) && decisions.some((value) => !value)) {
      return salt;
    }
  }
  return "salt-fallback";
};

const summarizeDecisions = (rows) => {
  const byProfile = new Map();
  for (const row of rows) {
    const list = byProfile.get(row.profileId) ?? [];
    list.push(row);
    byProfile.set(row.profileId, list);
  }
  return byProfile;
};

const expectDeterministic = (rows) => {
  const byProfile = summarizeDecisions(rows);
  for (const [profileId, entries] of byProfile.entries()) {
    const uniqueOutcomes = new Set(entries.map((entry) => `${entry.show}:${entry.variant}:${entry.campaign}`));
    expect(uniqueOutcomes.size, `non-deterministic outcome for ${profileId}`).toBe(1);
  }
};

test("measurement loop: holdout + variants + events + report + tune weights", async ({ page, request }) => {
  test.setTimeout(120000);

  const suffix = uniqueSuffix();
  const appKey = `e2e_app_${suffix}`;
  const placementKey = `e2e_place_${suffix}`;
  const campaignKey = `e2e_measure_${suffix}`;
  const holdoutPercentage = 40;
  const holdoutSalt = pickSaltForMixedHoldout(campaignKey, holdoutPercentage);

  await postJson(
    request,
    "/v1/inapp/apps",
    "create app",
    { key: appKey, name: `E2E App ${suffix}`, platforms: ["web"] },
    writeHeaders()
  );

  await postJson(
    request,
    "/v1/inapp/placements",
    "create placement",
    {
      key: placementKey,
      name: `E2E Placement ${suffix}`,
      description: "isolated measurement placement",
      allowedTemplateKeys: ["banner_v1"],
      defaultTtlSeconds: 1800
    },
    writeHeaders()
  );

  const variants50 = [
    {
      variantKey: "A",
      weight: 50,
      contentJson: {
        title: "Variant A {{first_name}}",
        subtitle: "A path",
        cta: "Open A",
        image: "https://cdn.example.com/a.jpg",
        deeplink: "app://a"
      }
    },
    {
      variantKey: "B",
      weight: 50,
      contentJson: {
        title: "Variant B {{first_name}}",
        subtitle: "B path",
        cta: "Open B",
        image: "https://cdn.example.com/b.jpg",
        deeplink: "app://b"
      }
    }
  ];

  const created = await postJson(
    request,
    "/v1/inapp/campaigns",
    "create campaign",
    {
      key: campaignKey,
      name: `Measurement ${campaignKey}`,
      description: "measurement e2e",
      appKey,
      placementKey,
      templateKey: "banner_v1",
      status: "DRAFT",
      priority: 500,
      ttlSeconds: 1800,
      holdoutEnabled: true,
      holdoutPercentage,
      holdoutSalt,
      variants: variants50,
      tokenBindingsJson: {
        first_name: "mx_first_name_last|takeFirst"
      }
    },
    writeHeaders()
  );
  const campaignId = created.item.id;

  await postJson(
    request,
    `/v1/inapp/campaigns/${campaignId}/activate`,
    "activate campaign",
    {},
    writeHeaders()
  );

  const runDecides = async () => {
    const rows = [];
    for (const profileId of profiles) {
      for (let run = 0; run < 4; run += 1) {
        const decide = await postJson(
          request,
          "/v2/inapp/decide",
          `inapp decide ${profileId} run ${run + 1}`,
          {
            appKey,
            placement: placementKey,
            profileId,
            context: {
              locale: "en-US",
              deviceType: "ios"
            }
          },
          readHeaders()
        );
        rows.push({
          profileId,
          show: Boolean(decide.show),
          campaign: decide.tracking?.campaign_id ?? "",
          variant: decide.tracking?.variant_id ?? "",
          messageId: decide.tracking?.message_id ?? ""
        });
      }
    }
    return rows;
  };

  const preRows = await runDecides();
  expectDeterministic(preRows);
  expect(preRows.some((row) => row.show)).toBeTruthy();
  expect(preRows.some((row) => !row.show)).toBeTruthy();

  const firstByProfile = new Map();
  for (const row of preRows) {
    if (!firstByProfile.has(row.profileId)) {
      firstByProfile.set(row.profileId, row);
    }
  }

  for (const row of firstByProfile.values()) {
    if (!row.show) {
      continue;
    }
    const tracking = {
      campaign_id: row.campaign,
      message_id: row.messageId,
      variant_id: row.variant
    };
    await postJson(
      request,
      "/v2/inapp/events",
      `impression ${row.profileId}`,
      {
        eventType: "IMPRESSION",
        appKey,
        placement: placementKey,
        tracking,
        profileId: row.profileId,
        context: { phase: "pre" }
      },
      readHeaders()
    );
    if (row.variant === "B") {
      await postJson(
        request,
        "/v2/inapp/events",
        `click ${row.profileId}`,
        {
          eventType: "CLICK",
          appKey,
          placement: placementKey,
          tracking,
          profileId: row.profileId,
          context: { phase: "pre" }
        },
        readHeaders()
      );
    } else {
      await postJson(
        request,
        "/v2/inapp/events",
        `dismiss ${row.profileId}`,
        {
          eventType: "DISMISS",
          appKey,
          placement: placementKey,
          tracking,
          profileId: row.profileId,
          context: { phase: "pre" }
        },
        readHeaders()
      );
    }
  }

  let report = null;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    report = await getJson(request, `/v1/inapp/reports/campaign/${campaignKey}`, "campaign report", readHeaders());
    if (Array.isArray(report.series) && report.series.length > 0) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  expect(Array.isArray(report.series)).toBeTruthy();
  expect(report.series.length).toBeGreaterThan(0);

  const csvResponse = await request.get(`${apiBase}/v1/inapp/reports/export.csv?campaignKey=${campaignKey}`, {
    headers: readHeaders()
  });
  expect(csvResponse.ok()).toBeTruthy();
  const csv = await csvResponse.text();
  expect(csv).toContain(campaignKey);

  const current = await getJson(request, `/v1/inapp/campaigns/${campaignId}`, "load campaign for tuning", readHeaders());
  await putJson(
    request,
    `/v1/inapp/campaigns/${campaignId}`,
    "update weights",
    {
      ...current.item,
      description: "weights tuned to B",
      variants: [
        {
          variantKey: "A",
          weight: 20,
          contentJson: variants50[0].contentJson
        },
        {
          variantKey: "B",
          weight: 80,
          contentJson: variants50[1].contentJson
        }
      ]
    },
    writeHeaders()
  );

  await postJson(
    request,
    `/v1/inapp/campaigns/${campaignId}/activate`,
    "reactivate tuned campaign",
    {},
    writeHeaders()
  );

  const postRows = await runDecides();
  expectDeterministic(postRows);

  const preOutcomeByProfile = new Map(
    [...firstByProfile.values()].map((row) => [row.profileId, { show: row.show }])
  );
  const postFirstByProfile = new Map();
  for (const row of postRows) {
    if (!postFirstByProfile.has(row.profileId)) {
      postFirstByProfile.set(row.profileId, row);
    }
  }
  for (const [profileId, preOutcome] of preOutcomeByProfile.entries()) {
    const postOutcome = postFirstByProfile.get(profileId);
    expect(Boolean(postOutcome), `missing post outcome for ${profileId}`).toBeTruthy();
    expect(postOutcome.show, `holdout/treatment changed for ${profileId}`).toBe(preOutcome.show);
  }

  await page.goto(`/engagement/inapp/reports/${campaignKey}`);
  await expect(page.getByText(`Campaign Report: ${campaignKey}`)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Variant Comparison" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Daily Time Series" })).toBeVisible();
});

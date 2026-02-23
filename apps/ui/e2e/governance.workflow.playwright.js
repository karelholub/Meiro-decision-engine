import { test, expect } from "@playwright/test";
import { getJson, postJson, putJson, readHeaders, uniqueSuffix, writeHeaders } from "./helpers/api-helpers.js";

test("governance flow: submit, approve, reject, rollback, audit trail", async ({ page, request }) => {
  test.setTimeout(120000);

  const suffix = uniqueSuffix();
  const campaignKey = `e2e_gov_${suffix}`;

  const created = await postJson(
    request,
    "/v1/inapp/campaigns",
    "create governance campaign",
    {
      key: campaignKey,
      name: `Governance ${campaignKey}`,
      description: "governance e2e",
      appKey: "meiro_store",
      placementKey: "home_top",
      templateKey: "banner_v1",
      status: "DRAFT",
      priority: 20,
      ttlSeconds: 900,
      holdoutEnabled: false,
      holdoutPercentage: 0,
      holdoutSalt: `${campaignKey}-salt`,
      variants: [
        {
          variantKey: "A",
          weight: 100,
          contentJson: {
            title: "Gov v1",
            subtitle: "safe",
            cta: "Open",
            image: "https://cdn.example.com/gov-v1.jpg",
            deeplink: "app://gov-v1"
          }
        }
      ],
      tokenBindingsJson: {}
    },
    writeHeaders({ "x-user-id": "editor-1", "x-user-role": "EDITOR" })
  );

  const campaignId = created.item.id;

  const submit1 = await postJson(
    request,
    `/v1/inapp/campaigns/${campaignId}/submit-for-approval`,
    "submit for approval (1)",
    { comment: "initial submit" },
    writeHeaders({ "x-user-id": "editor-1", "x-user-role": "EDITOR" })
  );
  expect(submit1.item.status).toBe("PENDING_APPROVAL");

  const approve1 = await postJson(
    request,
    `/v1/inapp/campaigns/${campaignId}/approve-and-activate`,
    "approve and activate (1)",
    { comment: "approved baseline" },
    writeHeaders({ "x-user-id": "approver-1", "x-user-role": "APPROVER" })
  );
  expect(approve1.item.status).toBe("ACTIVE");

  const current = await getJson(request, `/v1/inapp/campaigns/${campaignId}`, "load campaign for risky update", readHeaders());
  const riskyPayload = {
    ...current.item,
    description: "risky edit",
    holdoutEnabled: true,
    holdoutPercentage: 95,
    variants: [
      {
        variantKey: "A",
        weight: 100,
        contentJson: {
          title: "Gov risky",
          subtitle: "high holdout",
          cta: "Open",
          image: "https://cdn.example.com/gov-risky.jpg",
          deeplink: "app://gov-risky"
        }
      }
    ]
  };

  await putJson(
    request,
    `/v1/inapp/campaigns/${campaignId}`,
    "save risky edit",
    riskyPayload,
    writeHeaders({ "x-user-id": "editor-1", "x-user-role": "EDITOR" })
  );

  const submit2 = await postJson(
    request,
    `/v1/inapp/campaigns/${campaignId}/submit-for-approval`,
    "submit for approval (2)",
    { comment: "risky submit" },
    writeHeaders({ "x-user-id": "editor-1", "x-user-role": "EDITOR" })
  );
  expect(submit2.item.status).toBe("PENDING_APPROVAL");

  const reject = await postJson(
    request,
    `/v1/inapp/campaigns/${campaignId}/reject-to-draft`,
    "reject to draft",
    { comment: "too risky" },
    writeHeaders({ "x-user-id": "approver-1", "x-user-role": "APPROVER" })
  );
  expect(reject.item.status).toBe("DRAFT");

  const safePayload = {
    ...riskyPayload,
    description: "safe re-edit",
    holdoutPercentage: 10
  };
  await putJson(
    request,
    `/v1/inapp/campaigns/${campaignId}`,
    "save safe edit",
    safePayload,
    writeHeaders({ "x-user-id": "editor-1", "x-user-role": "EDITOR" })
  );

  const submit3 = await postJson(
    request,
    `/v1/inapp/campaigns/${campaignId}/submit-for-approval`,
    "submit for approval (3)",
    { comment: "safe submit" },
    writeHeaders({ "x-user-id": "editor-1", "x-user-role": "EDITOR" })
  );
  expect(submit3.item.status).toBe("PENDING_APPROVAL");

  const approve2 = await postJson(
    request,
    `/v1/inapp/campaigns/${campaignId}/approve-and-activate`,
    "approve and activate (2)",
    { comment: "safe approved" },
    writeHeaders({ "x-user-id": "approver-1", "x-user-role": "APPROVER" })
  );
  expect(approve2.item.status).toBe("ACTIVE");

  const versions = await getJson(request, `/v1/inapp/campaigns/${campaignId}/versions`, "list versions", readHeaders());
  expect(Array.isArray(versions.items)).toBeTruthy();
  expect(versions.items.length).toBeGreaterThan(1);

  const oldestVersion = versions.items[versions.items.length - 1].version;
  const rollback = await postJson(
    request,
    `/v1/inapp/campaigns/${campaignId}/rollback`,
    "rollback",
    { version: oldestVersion },
    writeHeaders({ "x-user-id": "approver-1", "x-user-role": "APPROVER" })
  );
  expect(rollback.item.status).toBe("ACTIVE");
  expect(rollback.item.lastReviewComment).toContain("Rollback to version");

  const audit = await getJson(request, `/v1/inapp/campaigns/${campaignId}/audit?limit=50`, "load audit", readHeaders());
  const actions = audit.items.map((entry) => entry.action);
  expect(actions).toContain("submit_for_approval");
  expect(actions).toContain("approve_and_activate");
  expect(actions).toContain("reject_to_draft");
  expect(actions).toContain("rollback_campaign");

  await page.goto(`/engagement/inapp/campaigns/${campaignId}`);
  await page.getByRole("button", { name: "Governance", exact: true }).click();
  await expect(page.getByText("Versions")).toBeVisible();
  await expect(page.getByText("Audit Log")).toBeVisible();
  await expect(page.getByText("rollback_campaign")).toBeVisible();
});

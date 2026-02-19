import { describe, expect, it, vi } from "vitest";
import { MockMeiroAdapter } from "@decisioning/meiro";
import { buildApp } from "../src/app";

const fixedNow = new Date("2026-02-19T16:00:00.000Z");

type InAppCampaignFixture = {
  id: string;
  environment: "DEV";
  key: string;
  name: string;
  description: string | null;
  status: "ACTIVE";
  appKey: string;
  placementKey: string;
  templateKey: string;
  priority: number;
  ttlSeconds: number;
  startAt: Date | null;
  endAt: Date | null;
  holdoutEnabled: boolean;
  holdoutPercentage: number;
  holdoutSalt: string;
  capsPerProfilePerDay: number | null;
  capsPerProfilePerWeek: number | null;
  eligibilityAudiencesAny: unknown;
  tokenBindingsJson: unknown;
  updatedAt: Date;
  variants: Array<{
    id: string;
    campaignId: string;
    variantKey: string;
    weight: number;
    contentJson: Record<string, unknown>;
    createdAt: Date;
    updatedAt: Date;
  }>;
};

const baseCampaign = (): InAppCampaignFixture => ({
  id: "inapp-campaign-1",
  environment: "DEV",
  key: "demo_home_top",
  name: "Demo Home Top",
  description: null,
  status: "ACTIVE",
  appKey: "meiro_store",
  placementKey: "home_top",
  templateKey: "banner_v1",
  priority: 10,
  ttlSeconds: 3600,
  startAt: null,
  endAt: null,
  holdoutEnabled: false,
  holdoutPercentage: 0,
  holdoutSalt: "deterministic-salt",
  capsPerProfilePerDay: null,
  capsPerProfilePerWeek: null,
  eligibilityAudiencesAny: null,
  tokenBindingsJson: {
    first_name: "mx_first_name_last|takeFirst",
    rfm: "web_rfm|takeFirst",
    churn: "web_churn_risk_score|takeFirst",
    spend: "web_total_spend|coerceNumber",
    recommended_product: "web_product_recommended2|parseJsonIfString|takeFirst"
  },
  updatedAt: fixedNow,
  variants: [
    {
      id: "variant-a",
      campaignId: "inapp-campaign-1",
      variantKey: "A",
      weight: 50,
      contentJson: {
        title: "Hey {{first_name}}",
        subtitle: "RFM {{rfm}} churn {{churn}} spend {{spend}}",
        cta: "View {{recommended_product.name}}",
        image: "https://cdn.example.com/a.jpg",
        deeplink: "app://product/{{recommended_product.id}}"
      },
      createdAt: fixedNow,
      updatedAt: fixedNow
    },
    {
      id: "variant-b",
      campaignId: "inapp-campaign-1",
      variantKey: "B",
      weight: 50,
      contentJson: {
        title: "Hello {{first_name}}",
        subtitle: "Fallback",
        cta: "Open",
        image: "https://cdn.example.com/b.jpg",
        deeplink: "app://home"
      },
      createdAt: fixedNow,
      updatedAt: fixedNow
    }
  ]
});

const createPrisma = (campaignFixture: InAppCampaignFixture) => {
  const impressions: Array<{
    environment: "DEV";
    campaignKey: string;
    profileId: string;
    timestamp: Date;
    messageId: string;
  }> = [];

  const logs: unknown[] = [];

  const prisma = {
    inAppCampaign: {
      findMany: vi.fn().mockImplementation(async () => [campaignFixture])
    },
    inAppPlacement: {
      findFirst: vi.fn().mockResolvedValue({
        id: "placement-1",
        environment: "DEV",
        key: "home_top",
        name: "Home Top",
        description: null,
        allowedTemplateKeys: ["banner_v1"],
        defaultTtlSeconds: 3600,
        createdAt: fixedNow,
        updatedAt: fixedNow
      })
    },
    inAppTemplate: {
      findFirst: vi.fn().mockResolvedValue({
        id: "template-1",
        environment: "DEV",
        key: "banner_v1",
        name: "Banner v1",
        schemaJson: {
          required: ["title", "subtitle", "cta", "image", "deeplink"],
          properties: {
            title: { type: "string" },
            subtitle: { type: "string" },
            cta: { type: "string" },
            image: { type: "string" },
            deeplink: { type: "string" }
          }
        },
        createdAt: fixedNow,
        updatedAt: fixedNow
      })
    },
    inAppImpression: {
      count: vi.fn().mockImplementation(async ({ where }: any) => {
        return impressions.filter((entry) => {
          if (where.environment && entry.environment !== where.environment) {
            return false;
          }
          if (where.campaignKey && entry.campaignKey !== where.campaignKey) {
            return false;
          }
          if (where.profileId && entry.profileId !== where.profileId) {
            return false;
          }
          if (where.timestamp?.gte && entry.timestamp < where.timestamp.gte) {
            return false;
          }
          return true;
        }).length;
      }),
      create: vi.fn().mockImplementation(async ({ data }: any) => {
        impressions.push({
          environment: data.environment,
          campaignKey: data.campaignKey,
          profileId: data.profileId,
          messageId: data.messageId,
          timestamp: data.timestamp
        });
        return { id: `imp-${impressions.length}`, ...data };
      })
    },
    inAppDecisionLog: {
      create: vi.fn().mockImplementation(async ({ data }: any) => {
        logs.push(data);
        return { id: `log-${logs.length}`, ...data };
      })
    },
    decisionVersion: {
      findFirst: vi.fn().mockResolvedValue(null)
    },
    wbsInstance: {
      findFirst: vi.fn().mockResolvedValue(null)
    },
    wbsMapping: {
      findFirst: vi.fn().mockResolvedValue(null)
    },
    $transaction: vi.fn().mockImplementation(async (cb: any) => cb(prisma)),
    $disconnect: vi.fn().mockResolvedValue(undefined)
  };

  return {
    prisma,
    impressions,
    logs
  };
};

const meiro = new MockMeiroAdapter([
  {
    profileId: "p-1001",
    attributes: {
      mx_first_name_last: ["Alex"],
      web_rfm: ["Champions"],
      web_churn_risk_score: ["0.21"],
      web_total_spend: ["1240.55"],
      web_product_recommended2: ['[{"id":"sku-42","name":"City Sneaker"}]']
    },
    audiences: ["vip", "newsletter"],
    consents: ["email_marketing"]
  },
  {
    profileId: "p-2000",
    attributes: {
      mx_first_name_last: ["Sam"],
      web_rfm: ["New"],
      web_churn_risk_score: ["0.03"],
      web_total_spend: ["220"],
      web_product_recommended2: ['[{"id":"sku-99","name":"Basic Tee"}]']
    },
    audiences: ["newsletter"],
    consents: ["email_marketing"]
  }
]);

const runDecide = async (campaignFixture: InAppCampaignFixture, profileId = "p-1001") => {
  const { prisma, impressions, logs } = createPrisma(campaignFixture);
  const app = await buildApp({
    prisma: prisma as any,
    meiroAdapter: meiro,
    now: () => fixedNow
  });

  const response = await app.inject({
    method: "POST",
    url: "/v1/inapp/decide",
    headers: {
      "x-env": "DEV"
    },
    payload: {
      appKey: "meiro_store",
      placement: "home_top",
      profileId,
      debug: true
    }
  });

  await app.close();
  return {
    statusCode: response.statusCode,
    body: response.json(),
    impressions,
    logs
  };
};

describe("POST /v1/inapp/decide", () => {
  it("returns deterministic variant for identical profile/campaign inputs", async () => {
    const campaign = baseCampaign();

    const first = await runDecide(campaign, "p-1001");
    const second = await runDecide(campaign, "p-1001");

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(first.body.show).toBe(true);
    expect(second.body.show).toBe(true);
    expect(first.body.tracking.variant_id).toBe(second.body.tracking.variant_id);
    expect(first.body.tracking.message_id).toBe(second.body.tracking.message_id);
  });

  it("enforces deterministic holdout", async () => {
    const campaign = baseCampaign();
    campaign.holdoutEnabled = true;
    campaign.holdoutPercentage = 100;

    const result = await runDecide(campaign, "p-1001");

    expect(result.statusCode).toBe(200);
    expect(result.body.show).toBe(false);
    expect(result.body.templateId).toBe("none");
    expect(result.body.tracking.campaign_id).toBe("");
  });

  it("enforces daily caps using in-app impressions", async () => {
    const campaign = baseCampaign();
    campaign.capsPerProfilePerDay = 1;

    const { prisma } = createPrisma(campaign);
    const app = await buildApp({ prisma: prisma as any, meiroAdapter: meiro, now: () => fixedNow });

    const first = await app.inject({
      method: "POST",
      url: "/v1/inapp/decide",
      headers: { "x-env": "DEV" },
      payload: {
        appKey: "meiro_store",
        placement: "home_top",
        profileId: "p-1001"
      }
    });

    const second = await app.inject({
      method: "POST",
      url: "/v1/inapp/decide",
      headers: { "x-env": "DEV" },
      payload: {
        appKey: "meiro_store",
        placement: "home_top",
        profileId: "p-1001"
      }
    });

    await app.close();

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(first.json().show).toBe(true);
    expect(second.json().show).toBe(false);
  });

  it("renders tokenized content including parseJsonIfString + takeFirst", async () => {
    const campaign = baseCampaign();

    const result = await runDecide(campaign, "p-1001");

    expect(result.statusCode).toBe(200);
    expect(result.body.show).toBe(true);
    expect(result.body.payload.title).toContain("Alex");
    expect(result.body.payload.cta).toContain("City Sneaker");
    expect(result.body.payload.deeplink).toContain("sku-42");
    expect(result.body.payload.subtitle).toContain("1240.55");
  });

  it("filters campaigns by eligibility audiencesAny", async () => {
    const campaign = baseCampaign();
    campaign.eligibilityAudiencesAny = ["vip_only"];

    const result = await runDecide(campaign, "p-2000");

    expect(result.statusCode).toBe(200);
    expect(result.body.show).toBe(false);
    expect(result.body.templateId).toBe("none");
  });
});

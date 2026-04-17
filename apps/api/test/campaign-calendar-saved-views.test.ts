import { describe, expect, it, vi } from "vitest";
import { MockMeiroAdapter } from "@decisioning/meiro";
import { buildApp } from "../src/app";

const fixedDate = new Date("2026-04-15T12:00:00.000Z");

const buildPrisma = () => ({
  campaignCalendarSavedView: {
    findMany: vi.fn().mockResolvedValue([
      {
        id: "view-1",
        environment: "DEV",
        userId: "planner-1",
        name: "Approvals this week",
        view: "week",
        swimlane: "planning_state",
        filtersJson: {
          status: "PENDING_APPROVAL",
          appKey: "",
          placementKey: "",
          assetKey: "",
          assetType: "",
          includeArchived: false
        },
        createdAt: fixedDate,
        updatedAt: fixedDate
      }
    ]),
    create: vi.fn().mockImplementation(async ({ data }) => ({
      id: "view-new",
      ...data,
      createdAt: fixedDate,
      updatedAt: fixedDate
    })),
    findFirst: vi.fn().mockResolvedValue({
      id: "view-1",
      environment: "DEV",
      userId: "planner-1",
      name: "Approvals this week",
      view: "week",
      swimlane: "planning_state",
      filtersJson: {
        status: "PENDING_APPROVAL",
        appKey: "",
        placementKey: "",
        assetKey: "",
        assetType: "",
        includeArchived: false
      },
      createdAt: fixedDate,
      updatedAt: fixedDate
    }),
    update: vi.fn().mockImplementation(async ({ data }) => ({
      id: "view-1",
      environment: "DEV",
      userId: "planner-1",
      ...data,
      createdAt: fixedDate,
      updatedAt: fixedDate
    })),
    delete: vi.fn().mockResolvedValue({})
  },
  inAppAuditLog: {
    create: vi.fn().mockImplementation(async ({ data }) => ({
      id: "audit-1",
      ...data,
      createdAt: fixedDate
    })),
    findMany: vi.fn().mockResolvedValue([
      {
        id: "audit-1",
        environment: "DEV",
        userId: "planner-1",
        userRole: "VIEWER",
        action: "campaign_calendar_export",
        entityType: "campaign_calendar",
        entityId: "csv:2026-04-01T00:00:00.000Z:2026-04-30T23:59:59.999Z",
        beforeHash: null,
        afterHash: null,
        metaJson: {
          kind: "csv",
          itemCount: 3,
          view: "month",
          swimlane: "readiness"
        },
        createdAt: fixedDate
      }
    ])
  },
  campaignCalendarReviewPack: {
    findMany: vi.fn().mockResolvedValue([
      {
        id: "pack-1",
        environment: "DEV",
        name: "April review",
        createdByUserId: "planner-1",
        view: "month",
        swimlane: "readiness",
        from: new Date("2026-04-01T00:00:00.000Z"),
        to: new Date("2026-04-30T23:59:59.999Z"),
        filtersJson: {
          status: "",
          appKey: "",
          placementKey: "",
          assetKey: "",
          assetType: "",
          includeArchived: false
        },
        summaryJson: {
          total: 1,
          scheduled: 1,
          unscheduled: 0,
          atRisk: 1,
          blockingIssues: 1,
          conflicts: 0,
          overlapRisk: { none: 1, low: 0, medium: 0, high: 0, critical: 0 },
          pressureRisk: { none: 1, low: 0, medium: 0, high: 0, critical: 0 },
          needsAttention: 1,
          hotspots: []
        },
        snapshotJson: {
          risks: {
            atRisk: 1,
            blockingIssues: 1,
            conflicts: 0,
            overlapRisk: { none: 1, low: 0, medium: 0, high: 0, critical: 0 },
            pressureRisk: { none: 1, low: 0, medium: 0, high: 0, critical: 0 },
            needsAttention: 1
          },
          approvalQueue: [],
          placementPressure: [],
          hotspots: [],
          campaignIds: ["campaign-1"]
        },
        campaignIdsJson: ["campaign-1"],
        createdAt: fixedDate
      }
    ]),
    findFirst: vi.fn().mockResolvedValue({
      id: "pack-1",
      environment: "DEV",
      name: "April review",
      createdByUserId: "planner-1",
      view: "month",
      swimlane: "readiness",
      from: new Date("2026-04-01T00:00:00.000Z"),
      to: new Date("2026-04-30T23:59:59.999Z"),
      filtersJson: {
        status: "",
        appKey: "",
        placementKey: "",
        assetKey: "",
        assetType: "",
        includeArchived: false
      },
      summaryJson: {
        total: 1,
        scheduled: 1,
        unscheduled: 0,
        atRisk: 1,
        blockingIssues: 1,
        conflicts: 0,
        overlapRisk: { none: 1, low: 0, medium: 0, high: 0, critical: 0 },
        pressureRisk: { none: 1, low: 0, medium: 0, high: 0, critical: 0 },
        needsAttention: 1,
        hotspots: []
      },
      snapshotJson: {
        risks: {
          atRisk: 1,
          blockingIssues: 1,
          conflicts: 0,
          overlapRisk: { none: 1, low: 0, medium: 0, high: 0, critical: 0 },
          pressureRisk: { none: 1, low: 0, medium: 0, high: 0, critical: 0 },
          needsAttention: 1
        },
        approvalQueue: [],
        placementPressure: [],
        hotspots: [],
        campaignIds: ["campaign-1"]
      },
      campaignIdsJson: ["campaign-1"],
      createdAt: fixedDate
    }),
    create: vi.fn().mockImplementation(async ({ data }) => ({
      id: "pack-new",
      ...data,
      createdAt: fixedDate
    }))
  },
  inAppCampaign: {
    findMany: vi.fn().mockResolvedValue([
      {
        id: "campaign-1",
        key: "spring_home",
        name: "Spring home",
        description: null,
        status: "PENDING_APPROVAL",
        appKey: "web",
        placementKey: "home_top",
        templateKey: "banner_v1",
        contentKey: "hero_banner",
        offerKey: null,
        experimentKey: null,
        priority: 10,
        capsPerProfilePerDay: 1,
        capsPerProfilePerWeek: null,
        eligibilityAudiencesAny: ["buyers"],
        startAt: new Date("2026-04-10T00:00:00.000Z"),
        endAt: new Date("2026-04-20T00:00:00.000Z"),
        submittedAt: null,
        activatedAt: null,
        lastReviewComment: null,
        updatedAt: fixedDate
      }
    ])
  },
  contentBlock: {
    findMany: vi.fn().mockResolvedValue([
      {
        key: "hero_banner",
        name: "Hero banner",
        description: null,
        status: "ACTIVE",
        version: 1,
        updatedAt: fixedDate,
        tags: [],
        templateId: "banner_v1",
        schemaJson: { activationAsset: { assetType: "website_banner" } },
        localesJson: ["en"],
        startAt: null,
        endAt: null,
        variants: [{ locale: "en", channel: "web", placementKey: "home_top", payloadJson: { title: "Hero" } }]
      }
    ])
  },
  offer: {
    findMany: vi.fn().mockResolvedValue([])
  },
  inAppUser: {
    upsert: vi.fn().mockResolvedValue({})
  },
  $disconnect: vi.fn().mockResolvedValue(undefined)
});

const buildTestApp = async (prisma: ReturnType<typeof buildPrisma>) =>
  buildApp({
    prisma: prisma as any,
    meiroAdapter: new MockMeiroAdapter([]),
    now: () => fixedDate,
    config: {
      apiPort: 3001,
      protectDecide: false,
      meiroMode: "mock",
      inappEventsWorkerEnabled: false,
      dlqWorkerEnabled: false
    }
  });

const plannerHeaders = {
  "x-env": "DEV",
  "x-user-id": "planner-1",
  "x-user-role": "VIEWER"
};

describe("campaign calendar saved views", () => {
  it("lists and creates personal saved views", async () => {
    const prisma = buildPrisma();
    const app = await buildTestApp(prisma);

    const listResponse = await app.inject({
      method: "GET",
      url: "/v1/inapp/campaign-calendar/views",
      headers: plannerHeaders
    });

    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json().items[0]).toMatchObject({
      id: "view-1",
      name: "Approvals this week",
      filters: { status: "PENDING_APPROVAL" }
    });

    const createResponse = await app.inject({
      method: "POST",
      url: "/v1/inapp/campaign-calendar/views",
      headers: plannerHeaders,
      payload: {
        name: "Website pressure",
        view: "month",
        swimlane: "pressure_risk",
        filters: {
          status: "",
          appKey: "web",
          placementKey: "",
          assetKey: "",
          assetType: "website_banner",
          channel: "website_personalization",
          readiness: "at_risk",
          sourceType: "in_app_campaign",
          audienceKey: "buyers",
          overlapRisk: "high",
          pressureRisk: "high",
          pressureSignal: "cap_pressure",
          needsAttentionOnly: true,
          includeArchived: false
        }
      }
    });

    expect(createResponse.statusCode).toBe(201);
    expect(createResponse.json().item).toMatchObject({
      id: "view-new",
      name: "Website pressure",
      swimlane: "pressure_risk",
      filters: {
        appKey: "web",
        assetType: "website_banner",
        channel: "website_personalization",
        readiness: "at_risk",
        audienceKey: "buyers",
        overlapRisk: "high",
        pressureRisk: "high",
        pressureSignal: "cap_pressure",
        needsAttentionOnly: true
      }
    });
    expect(prisma.inAppAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "campaign_calendar_saved_view_create",
          entityType: "campaign_calendar_saved_view"
        })
      })
    );

    await app.close();
  });

  it("records and lists planning export audit events", async () => {
    const prisma = buildPrisma();
    const app = await buildTestApp(prisma);

    const auditResponse = await app.inject({
      method: "POST",
      url: "/v1/inapp/campaign-calendar/export-audit",
      headers: plannerHeaders,
      payload: {
        kind: "csv",
        from: "2026-04-01T00:00:00.000Z",
        to: "2026-04-30T23:59:59.999Z",
        view: "month",
        swimlane: "pressure_risk",
        filters: {
          status: "",
          appKey: "",
          placementKey: "",
          assetKey: "",
          assetType: "",
          overlapRisk: "",
          pressureRisk: "",
          pressureSignal: "",
          needsAttentionOnly: false,
          includeArchived: false
        },
        itemCount: 3,
        summary: {
          total: 3,
          scheduled: 2,
          unscheduled: 1,
          atRisk: 1,
          blockingIssues: 0,
          conflicts: 0
        }
      }
    });

    expect(auditResponse.statusCode).toBe(202);
    expect(prisma.inAppAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "campaign_calendar_export",
          entityType: "campaign_calendar",
          metaJson: expect.objectContaining({ kind: "csv", itemCount: 3 })
        })
      })
    );

    const listResponse = await app.inject({
      method: "GET",
      url: "/v1/inapp/campaign-calendar/export-audit?limit=5",
      headers: plannerHeaders
    });

    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json().items[0]).toMatchObject({
      id: "audit-1",
      userId: "planner-1",
      meta: { kind: "csv", itemCount: 3 }
    });

    await app.close();
  });

  it("creates and reads planning review pack snapshots", async () => {
    const prisma = buildPrisma();
    const app = await buildTestApp(prisma);

    const createResponse = await app.inject({
      method: "POST",
      url: "/v1/inapp/campaign-calendar/review-packs",
      headers: { ...plannerHeaders, "x-user-role": "EDITOR" },
      payload: {
        name: "April launch review",
        from: "2026-04-01T00:00:00.000Z",
        to: "2026-04-30T23:59:59.999Z",
        view: "month",
        swimlane: "pressure_risk",
        filters: {
          status: "",
          appKey: "",
          placementKey: "",
          assetKey: "",
          assetType: "",
          overlapRisk: "",
          pressureRisk: "",
          pressureSignal: "",
          needsAttentionOnly: false,
          includeArchived: false
        }
      }
    });

    expect(createResponse.statusCode).toBe(201);
    expect(createResponse.json().item).toMatchObject({
      id: "pack-new",
      name: "April launch review",
      swimlane: "pressure_risk",
      campaignIds: ["campaign-1"],
      snapshot: {
        campaignIds: ["campaign-1"],
        risks: expect.objectContaining({
          needsAttention: 0,
          overlapRisk: expect.objectContaining({ none: 1 }),
          pressureRisk: expect.objectContaining({ none: 1 })
        }),
        hotspots: [],
        campaigns: [expect.objectContaining({ campaignKey: "spring_home", overlapRisk: "none", pressureRisk: "none" })]
      }
    });
    expect(prisma.campaignCalendarReviewPack.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: "April launch review",
          createdByUserId: "planner-1",
          campaignIdsJson: ["campaign-1"]
        })
      })
    );
    expect(prisma.inAppAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "campaign_calendar_review_pack_create",
          entityType: "campaign_calendar_review_pack",
          metaJson: expect.objectContaining({ campaignCount: 1 })
        })
      })
    );

    const listResponse = await app.inject({
      method: "GET",
      url: "/v1/inapp/campaign-calendar/review-packs?limit=5",
      headers: plannerHeaders
    });
    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json().items[0]).toMatchObject({ id: "pack-1", name: "April review", campaignIds: ["campaign-1"] });

    const getResponse = await app.inject({
      method: "GET",
      url: "/v1/inapp/campaign-calendar/review-packs/pack-1",
      headers: plannerHeaders
    });
    expect(getResponse.statusCode).toBe(200);
    expect(getResponse.json().item).toMatchObject({ id: "pack-1", snapshot: { campaignIds: ["campaign-1"] } });

    await app.close();
  });
});

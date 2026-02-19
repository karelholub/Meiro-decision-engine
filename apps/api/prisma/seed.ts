import { Environment, InAppCampaignStatus, Prisma, PrismaClient, WbsProfileIdStrategy } from "@prisma/client";
import { createDefaultDecisionDefinition, type DecisionDefinition } from "@decisioning/dsl";
import type { MeiroProfile } from "@decisioning/meiro";
import { type WbsMappingConfig } from "@decisioning/wbs-mapping";

const prisma = new PrismaClient();

const toInputJson = (value: unknown): Prisma.InputJsonValue => {
  return value as Prisma.InputJsonValue;
};

const mockProfiles: MeiroProfile[] = [
  {
    profileId: "p-1001",
    attributes: {
      email: "alex@example.com",
      cartValue: 120,
      country: "US",
      churnRisk: "high"
    },
    audiences: ["cart_abandoners", "email_optin"],
    consents: ["email_marketing"]
  },
  {
    profileId: "p-1002",
    attributes: {
      email: "sam@example.com",
      cartValue: 40,
      country: "US",
      churnRisk: "low"
    },
    audiences: ["newsletter"],
    consents: []
  },
  {
    profileId: "p-1003",
    attributes: {
      email: "jamie@example.com",
      cartValue: 0,
      country: "DE",
      churnRisk: "medium"
    },
    audiences: ["global_suppress"],
    consents: ["email_marketing", "sms_marketing"]
  }
];

const cartRecoveryDefinition = (decisionId: string): DecisionDefinition => {
  const definition = createDefaultDecisionDefinition({
    id: decisionId,
    key: "cart_recovery",
    name: "Cart Recovery",
    description: "Send recovery reminders for abandoners with consent.",
    version: 1,
    status: "ACTIVE"
  });

  definition.holdout = {
    enabled: true,
    percentage: 10,
    salt: "cart-recovery-holdout"
  };
  definition.eligibility = {
    audiencesAny: ["cart_abandoners"],
    audiencesNone: ["global_suppress"],
    consent: {
      requiredConsents: ["email_marketing"]
    }
  };
  definition.caps = {
    perProfilePerDay: 1,
    perProfilePerWeek: 3
  };
  definition.policies = {
    requiredConsents: ["email_marketing"],
    payloadAllowlist: ["channel", "templateId", "campaign"],
    redactKeys: ["customerEmail"]
  };
  definition.writeback = {
    enabled: true,
    mode: "label",
    key: "last_decision_outcome",
    ttlDays: 30
  };
  definition.flow.rules = [
    {
      id: "high-cart",
      priority: 1,
      when: {
        type: "predicate",
        predicate: {
          field: "cartValue",
          op: "gte",
          value: 100
        }
      },
      then: {
        actionType: "message",
        payload: {
          channel: "email",
          templateId: "cart-recovery-high",
          campaign: "cart_recovery"
        }
      },
      else: {
        actionType: "personalize",
        payload: {
          variant: "cart-recovery-lite",
          campaign: "cart_recovery"
        }
      }
    }
  ];

  definition.outputs.default = {
    actionType: "noop",
    payload: {
      reason: "no_rule_match"
    }
  };

  return definition;
};

const suppressionDefinition = (decisionId: string): DecisionDefinition => {
  const definition = createDefaultDecisionDefinition({
    id: decisionId,
    key: "global_suppression",
    name: "Global Suppression",
    description: "Suppress profiles in global suppression audience.",
    version: 1,
    status: "ACTIVE"
  });

  definition.eligibility = {
    audiencesAny: ["global_suppress"]
  };
  definition.flow.rules = [
    {
      id: "suppress-all",
      priority: 1,
      then: {
        actionType: "suppress",
        payload: {
          reason: "GLOBAL_SUPPRESS"
        }
      }
    }
  ];

  return definition;
};

const upsertDecision = async (input: {
  key: string;
  name: string;
  description: string;
  environment: Environment;
  definitionFactory: (decisionId: string) => DecisionDefinition;
}) => {
  const existing = await prisma.decision.findFirst({
    where: { key: input.key, environment: input.environment },
    include: {
      versions: {
        where: { status: "ACTIVE" }
      }
    }
  });

  if (existing?.versions.length) {
    return;
  }

  const decision =
    existing ??
    (await prisma.decision.create({
      data: {
        environment: input.environment,
        key: input.key,
        name: input.name,
        description: input.description
      }
    }));

  const definition = input.definitionFactory(decision.id);
  await prisma.decisionVersion.create({
    data: {
      decisionId: decision.id,
      version: definition.version,
      status: "ACTIVE",
      definitionJson: toInputJson(definition),
      activatedAt: new Date(definition.activatedAt ?? definition.updatedAt),
      updatedAt: new Date(definition.updatedAt)
    }
  });
};

const upsertWbsInstance = async () => {
  const existingActive = await prisma.wbsInstance.findFirst({
    where: {
      environment: Environment.DEV,
      isActive: true
    }
  });

  if (existingActive) {
    return;
  }

  await prisma.wbsInstance.updateMany({
    where: {
      environment: Environment.DEV,
      isActive: true
    },
    data: {
      isActive: false
    }
  });

  await prisma.wbsInstance.create({
    data: {
      environment: Environment.DEV,
      name: "Meiro Store Demo",
      baseUrl: "https://cdp.store.demo.meiro.io/wbs",
      attributeParamName: "attribute",
      valueParamName: "value",
      segmentParamName: "segment",
      includeSegment: false,
      timeoutMs: 1500,
      isActive: true
    }
  });
};

const defaultWbsMapping: WbsMappingConfig = {
  attributeMappings: [
    { sourceKey: "web_rfm", targetKey: "web_rfm", transform: "takeFirst" },
    { sourceKey: "web_churn_risk_score", targetKey: "web_churn_risk_score", transform: "coerceNumber" },
    { sourceKey: "web_total_spend", targetKey: "web_total_spend", transform: "coerceNumber" },
    { sourceKey: "web_product_recommended2", targetKey: "web_product_recommended2", transform: "parseJsonIfString" },
    { sourceKey: "mea_open_time", targetKey: "mea_open_time", transform: "parseJsonIfString" },
    { sourceKey: "cookie_consent_status", targetKey: "cookie_consent_status", transform: "takeFirst" }
  ],
  audienceRules: [
    {
      id: "rfm-lost",
      audienceKey: "rfm_lost",
      when: { sourceKey: "web_rfm", op: "contains", value: "Lost" },
      transform: "takeFirst"
    },
    {
      id: "high-value",
      audienceKey: "high_value",
      when: { sourceKey: "web_total_spend", op: "gte", value: 8000 },
      transform: "coerceNumber"
    }
  ],
  consentMapping: {
    sourceKey: "cookie_consent_status",
    transform: "takeFirst",
    yesValues: ["yes"],
    noValues: ["no"]
  }
};

const upsertWbsMapping = async () => {
  const existingActive = await prisma.wbsMapping.findFirst({
    where: {
      environment: Environment.DEV,
      isActive: true
    }
  });

  if (existingActive) {
    return;
  }

  await prisma.wbsMapping.updateMany({
    where: {
      environment: Environment.DEV,
      isActive: true
    },
    data: {
      isActive: false
    }
  });

  await prisma.wbsMapping.create({
    data: {
      environment: Environment.DEV,
      name: "Default WBS Mapping",
      isActive: true,
      profileIdStrategy: WbsProfileIdStrategy.CUSTOMER_ENTITY_ID,
      profileIdAttributeKey: null,
      mappingJson: toInputJson(defaultWbsMapping)
    }
  });
};

const inAppTemplateSchema = {
  type: "object",
  required: ["title", "subtitle", "cta", "image", "deeplink"],
  properties: {
    title: { type: "string" },
    subtitle: { type: "string" },
    cta: { type: "string" },
    image: { type: "string" },
    deeplink: { type: "string" }
  }
};

const upsertInAppMvpSeed = async () => {
  await prisma.inAppApplication.upsert({
    where: {
      environment_key: {
        environment: Environment.DEV,
        key: "meiro_store"
      }
    },
    update: {
      name: "Meiro Store",
      platforms: toInputJson(["web", "ios", "android"])
    },
    create: {
      environment: Environment.DEV,
      key: "meiro_store",
      name: "Meiro Store",
      platforms: toInputJson(["web", "ios", "android"])
    }
  });

  await prisma.inAppTemplate.upsert({
    where: {
      environment_key: {
        environment: Environment.DEV,
        key: "banner_v1"
      }
    },
    update: {
      name: "Banner v1",
      schemaJson: toInputJson(inAppTemplateSchema)
    },
    create: {
      environment: Environment.DEV,
      key: "banner_v1",
      name: "Banner v1",
      schemaJson: toInputJson(inAppTemplateSchema)
    }
  });

  await prisma.inAppPlacement.upsert({
    where: {
      environment_key: {
        environment: Environment.DEV,
        key: "home_top"
      }
    },
    update: {
      name: "Home Top",
      description: "Primary banner placement at top of home feed.",
      allowedTemplateKeys: toInputJson(["banner_v1"]),
      defaultTtlSeconds: 3600
    },
    create: {
      environment: Environment.DEV,
      key: "home_top",
      name: "Home Top",
      description: "Primary banner placement at top of home feed.",
      allowedTemplateKeys: toInputJson(["banner_v1"]),
      defaultTtlSeconds: 3600
    }
  });

  const campaign = await prisma.inAppCampaign.upsert({
    where: {
      environment_key: {
        environment: Environment.DEV,
        key: "demo_home_top"
      }
    },
    update: {
      name: "Demo Home Top",
      description: "Demo campaign for in-app home banner placement.",
      status: InAppCampaignStatus.ACTIVE,
      appKey: "meiro_store",
      placementKey: "home_top",
      templateKey: "banner_v1",
      priority: 10,
      ttlSeconds: 3600,
      holdoutEnabled: false,
      holdoutPercentage: 0,
      holdoutSalt: "demo_home_top_holdout",
      tokenBindingsJson: toInputJson({
        first_name: "mx_first_name_last|takeFirst",
        rfm: "web_rfm|takeFirst",
        churn: "web_churn_risk_score|takeFirst",
        spend: "web_total_spend|takeFirst",
        recommended_product: "web_product_recommended2|parseJsonIfString|takeFirst"
      }),
      activatedAt: new Date()
    },
    create: {
      environment: Environment.DEV,
      key: "demo_home_top",
      name: "Demo Home Top",
      description: "Demo campaign for in-app home banner placement.",
      status: InAppCampaignStatus.ACTIVE,
      appKey: "meiro_store",
      placementKey: "home_top",
      templateKey: "banner_v1",
      priority: 10,
      ttlSeconds: 3600,
      holdoutEnabled: false,
      holdoutPercentage: 0,
      holdoutSalt: "demo_home_top_holdout",
      tokenBindingsJson: toInputJson({
        first_name: "mx_first_name_last|takeFirst",
        rfm: "web_rfm|takeFirst",
        churn: "web_churn_risk_score|takeFirst",
        spend: "web_total_spend|takeFirst",
        recommended_product: "web_product_recommended2|parseJsonIfString|takeFirst"
      }),
      activatedAt: new Date()
    }
  });

  await prisma.inAppCampaignVariant.deleteMany({
    where: {
      campaignId: campaign.id
    }
  });

  await prisma.inAppCampaignVariant.create({
    data: {
      campaignId: campaign.id,
      variantKey: "A",
      weight: 100,
      contentJson: toInputJson({
        title: "Hey {{first_name}} - quick pick for you",
        subtitle: "RFM {{rfm}} | churn {{churn}} | total spend {{spend}}",
        cta: "See {{recommended_product.name}}",
        image: "https://images.unsplash.com/photo-1483985988355-763728e1935b",
        deeplink: "meiro-store://products/{{recommended_product.id}}"
      })
    }
  });
};

const main = async () => {
  await upsertDecision({
    key: "cart_recovery",
    environment: Environment.DEV,
    name: "Cart Recovery",
    description: "Send recovery reminders for abandoners with consent.",
    definitionFactory: cartRecoveryDefinition
  });

  await upsertDecision({
    key: "global_suppression",
    environment: Environment.DEV,
    name: "Global Suppression",
    description: "Suppress profiles in global suppression audience.",
    definitionFactory: suppressionDefinition
  });

  await upsertWbsInstance();
  await upsertWbsMapping();
  await upsertInAppMvpSeed();

  const now = new Date();
  const conversionTimestamp = new Date(now);
  conversionTimestamp.setUTCDate(conversionTimestamp.getUTCDate() - 1);

  await prisma.conversion.upsert({
    where: { id: "11111111-1111-1111-1111-111111111111" },
    update: {
      profileId: "p-1001",
      timestamp: conversionTimestamp,
      type: "purchase",
      value: 120,
      metadata: { source: "seed" }
    },
    create: {
      id: "11111111-1111-1111-1111-111111111111",
      profileId: "p-1001",
      timestamp: conversionTimestamp,
      type: "purchase",
      value: 120,
      metadata: { source: "seed" }
    }
  });

  await prisma.conversion.upsert({
    where: { id: "22222222-2222-2222-2222-222222222222" },
    update: {
      profileId: "p-1002",
      timestamp: conversionTimestamp,
      type: "signup",
      metadata: { source: "seed" }
    },
    create: {
      id: "22222222-2222-2222-2222-222222222222",
      profileId: "p-1002",
      timestamp: conversionTimestamp,
      type: "signup",
      metadata: { source: "seed" }
    }
  });

  console.log(
    "Mock profiles available for testing:",
    mockProfiles.map((profile) => profile.profileId).join(", ")
  );
};

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

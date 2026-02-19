import { Prisma, PrismaClient } from "@prisma/client";
import { createDefaultDecisionDefinition, type DecisionDefinition } from "@decisioning/dsl";
import type { MeiroProfile } from "@decisioning/meiro";

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
  definitionFactory: (decisionId: string) => DecisionDefinition;
}) => {
  const existing = await prisma.decision.findUnique({
    where: { key: input.key },
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

const main = async () => {
  await upsertDecision({
    key: "cart_recovery",
    name: "Cart Recovery",
    description: "Send recovery reminders for abandoners with consent.",
    definitionFactory: cartRecoveryDefinition
  });

  await upsertDecision({
    key: "global_suppression",
    name: "Global Suppression",
    description: "Suppress profiles in global suppression audience.",
    definitionFactory: suppressionDefinition
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

import type { MeiroProfile } from "@decisioning/meiro";

export const seedMockProfiles: MeiroProfile[] = [
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

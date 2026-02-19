export interface MeiroProfile {
  profileId: string;
  attributes: Record<string, unknown>;
  audiences: string[];
  consents?: string[];
}

export interface MeiroAdapter {
  getProfile(profileId: string): Promise<MeiroProfile>;
  writeProfileLabel?: (profileId: string, key: string, value: string) => Promise<void>;
}

export interface RealMeiroAdapterConfig {
  baseUrl?: string;
  token?: string;
}

export class MockMeiroAdapter implements MeiroAdapter {
  private readonly profiles: Map<string, MeiroProfile>;

  constructor(seedProfiles: MeiroProfile[]) {
    this.profiles = new Map(seedProfiles.map((profile) => [profile.profileId, profile]));
  }

  async getProfile(profileId: string): Promise<MeiroProfile> {
    const profile = this.profiles.get(profileId);
    if (!profile) {
      throw new Error(`Profile not found: ${profileId}`);
    }
    return profile;
  }
}

export class RealMeiroAdapter implements MeiroAdapter {
  constructor(private readonly config: RealMeiroAdapterConfig) {}

  async getProfile(profileId: string): Promise<MeiroProfile> {
    if (!this.config.baseUrl || !this.config.token) {
      throw new Error("MEIRO_BASE_URL/MEIRO_TOKEN are not configured.");
    }

    const response = await fetch(`${this.config.baseUrl}/profiles/${profileId}`, {
      headers: {
        Authorization: `Bearer ${this.config.token}`,
        "Content-Type": "application/json"
      }
    });

    if (!response.ok) {
      throw new Error(`Meiro profile fetch failed: ${response.status}`);
    }

    // TODO: align this mapping to Meiro's exact profile + audience response contract.
    const payload = (await response.json()) as {
      profileId: string;
      attributes: Record<string, unknown>;
      audiences: string[];
      consents?: string[];
    };

    return {
      profileId: payload.profileId,
      attributes: payload.attributes ?? {},
      audiences: payload.audiences ?? [],
      consents: payload.consents ?? []
    };
  }
}

export const mockProfiles: MeiroProfile[] = [
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

export const createMeiroAdapter = (mode: "mock" | "real", config: RealMeiroAdapterConfig): MeiroAdapter => {
  if (mode === "real") {
    return new RealMeiroAdapter(config);
  }
  return new MockMeiroAdapter(mockProfiles);
};

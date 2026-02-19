export interface MeiroProfile {
  profileId: string;
  attributes: Record<string, unknown>;
  audiences: string[];
  consents?: string[];
}

export interface MeiroWritebackInput {
  mode: "label" | "attribute";
  key: string;
  value: string;
  ttlDays?: number;
}

export interface MeiroWritebackRecord extends MeiroWritebackInput {
  profileId: string;
  timestamp: string;
}

export interface MeiroAdapter {
  getProfile(profileId: string): Promise<MeiroProfile>;
  writebackOutcome?: (profileId: string, input: MeiroWritebackInput) => Promise<void>;
  getWritebackRecords?: (profileId: string) => MeiroWritebackRecord[];
  writeProfileLabel?: (profileId: string, key: string, value: string) => Promise<void>;
}

export interface RealMeiroAdapterConfig {
  baseUrl?: string;
  token?: string;
  timeoutMs?: number;
  maxRetries?: number;
}

export interface WbsInstanceConfig {
  baseUrl: string;
  attributeParamName: string;
  valueParamName: string;
  segmentParamName: string;
  includeSegment: boolean;
  defaultSegmentValue?: string | null;
  timeoutMs?: number;
}

export interface WbsLookupInput {
  attribute: string;
  value: string;
}

export interface WbsLookupResponse {
  status?: string;
  returned_attributes?: Record<string, unknown>;
  customer_entity_id?: string;
  [key: string]: unknown;
}

export interface WbsLookupAdapter {
  lookup(config: WbsInstanceConfig, input: WbsLookupInput): Promise<WbsLookupResponse>;
}

interface MeiroProfileApiPayload {
  profileId?: string;
  id?: string;
  attributes?: Record<string, unknown>;
  audiences?: unknown;
  consents?: unknown;
  profile?: {
    profileId?: string;
    id?: string;
    attributes?: Record<string, unknown>;
    consents?: unknown;
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const toAudienceIds = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const result: string[] = [];
  for (const entry of value) {
    if (typeof entry === "string") {
      result.push(entry);
      continue;
    }
    if (isRecord(entry)) {
      const candidate = entry.id ?? entry.key ?? entry.name;
      if (typeof candidate === "string" && candidate.length > 0) {
        result.push(candidate);
      }
    }
  }

  return result;
};

const toConsents = (value: unknown): string[] | undefined => {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string");
  }

  if (isRecord(value)) {
    return Object.entries(value)
      .filter(([, enabled]) => enabled === true)
      .map(([consent]) => consent);
  }

  return undefined;
};

const sleep = async (ms: number) => {
  await new Promise((resolve) => setTimeout(resolve, ms));
};

const parseJsonResponse = async <T>(response: Response): Promise<T> => {
  if (response.status === 204) {
    return undefined as T;
  }

  const bodyText = await response.text();
  if (!bodyText) {
    return undefined as T;
  }

  try {
    return JSON.parse(bodyText) as T;
  } catch {
    return undefined as T;
  }
};

export class MockMeiroAdapter implements MeiroAdapter {
  private readonly profiles: Map<string, MeiroProfile>;
  private readonly writebacks: Map<string, MeiroWritebackRecord[]>;

  constructor(seedProfiles: MeiroProfile[]) {
    this.profiles = new Map(seedProfiles.map((profile) => [profile.profileId, profile]));
    this.writebacks = new Map();
  }

  async getProfile(profileId: string): Promise<MeiroProfile> {
    const profile = this.profiles.get(profileId);
    if (!profile) {
      throw new Error(`Profile not found: ${profileId}`);
    }
    return profile;
  }

  async writebackOutcome(profileId: string, input: MeiroWritebackInput): Promise<void> {
    const list = this.writebacks.get(profileId) ?? [];
    list.push({
      profileId,
      mode: input.mode,
      key: input.key,
      value: input.value,
      ttlDays: input.ttlDays,
      timestamp: new Date().toISOString()
    });
    this.writebacks.set(profileId, list);
  }

  getWritebackRecords(profileId: string): MeiroWritebackRecord[] {
    const list = this.writebacks.get(profileId) ?? [];
    return list.map((entry) => ({ ...entry }));
  }

  async writeProfileLabel(profileId: string, key: string, value: string): Promise<void> {
    await this.writebackOutcome(profileId, { mode: "label", key, value });
  }
}

export class RealMeiroAdapter implements MeiroAdapter {
  private readonly timeoutMs: number;
  private readonly maxRetries: number;

  constructor(private readonly config: RealMeiroAdapterConfig) {
    this.timeoutMs = config.timeoutMs ?? 1500;
    this.maxRetries = config.maxRetries ?? 1;
  }

  private resolveBaseUrlAndToken(): { baseUrl: string; token: string } {
    if (!this.config.baseUrl || !this.config.token) {
      throw new Error("MEIRO_BASE_URL/MEIRO_TOKEN are not configured.");
    }
    return {
      baseUrl: this.config.baseUrl.replace(/\/$/, ""),
      token: this.config.token
    };
  }

  private async requestWithRetries<T>(input: {
    method: "GET" | "POST" | "PUT" | "PATCH";
    url: string;
    body?: Record<string, unknown>;
    token: string;
  }): Promise<T> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const response = await fetch(input.url, {
          method: input.method,
          headers: {
            Authorization: `Bearer ${input.token}`,
            "Content-Type": "application/json"
          },
          body: input.body ? JSON.stringify(input.body) : undefined,
          signal: controller.signal
        });

        if (!response.ok) {
          const shouldRetry = response.status >= 500 && attempt < this.maxRetries;
          if (shouldRetry) {
            await sleep(100 * (attempt + 1));
            continue;
          }
          throw new Error(`Meiro request failed: HTTP ${response.status}`);
        }

        return parseJsonResponse<T>(response);
      } catch (error) {
        lastError = error;
        if (attempt < this.maxRetries) {
          await sleep(100 * (attempt + 1));
          continue;
        }
      } finally {
        clearTimeout(timeout);
      }
    }

    throw new Error(`Meiro request failed after retries: ${String(lastError)}`);
  }

  private async fetchProfilePayload(profileId: string): Promise<MeiroProfileApiPayload> {
    const { baseUrl, token } = this.resolveBaseUrlAndToken();
    const url = `${baseUrl}/profiles/${encodeURIComponent(profileId)}`;
    return this.requestWithRetries<MeiroProfileApiPayload>({
      method: "GET",
      url,
      token
    });
  }

  async getProfile(profileId: string): Promise<MeiroProfile> {
    const payload = await this.fetchProfilePayload(profileId);

    const resolvedProfileId = payload.profileId ?? payload.id ?? payload.profile?.profileId ?? payload.profile?.id ?? profileId;
    const attributes = payload.attributes ?? payload.profile?.attributes ?? {};
    const audiences = toAudienceIds(payload.audiences);
    const consents = toConsents(payload.consents ?? payload.profile?.consents);

    return {
      profileId: resolvedProfileId,
      attributes,
      audiences,
      consents
    };
  }

  async writeProfileLabel(_profileId: string, _key: string, _value: string): Promise<void> {
    // Placeholder for future Meiro write-back integration.
    throw new Error("Not implemented: writeProfileLabel");
  }

  async writebackOutcome(profileId: string, input: MeiroWritebackInput): Promise<void> {
    const { baseUrl, token } = this.resolveBaseUrlAndToken();
    const endpoint =
      input.mode === "label"
        ? `${baseUrl}/profiles/${encodeURIComponent(profileId)}/labels`
        : `${baseUrl}/profiles/${encodeURIComponent(profileId)}/attributes`;

    // TODO: Confirm exact writeback endpoint and payload contract with Meiro CDP.
    await this.requestWithRetries({
      method: "POST",
      url: endpoint,
      token,
      body: {
        key: input.key,
        value: input.value,
        ttlDays: input.ttlDays
      }
    });
  }
}

export class WbsMeiroAdapter implements WbsLookupAdapter {
  private readonly maxRetries: number;

  constructor(
    private readonly deps: {
      fetchImpl?: typeof fetch;
      maxRetries?: number;
    } = {}
  ) {
    this.maxRetries = deps.maxRetries ?? 1;
  }

  async lookup(config: WbsInstanceConfig, input: WbsLookupInput): Promise<WbsLookupResponse> {
    const fetchImpl = this.deps.fetchImpl ?? fetch;
    const params = new URLSearchParams();
    params.set(config.attributeParamName, input.attribute);
    params.set(config.valueParamName, input.value);

    if (config.includeSegment && config.defaultSegmentValue) {
      params.set(config.segmentParamName, config.defaultSegmentValue);
    }

    const baseUrl = config.baseUrl.replace(/\/$/, "");
    const url = `${baseUrl}?${params.toString()}`;
    const timeoutMs = config.timeoutMs ?? 1500;

    let lastError: unknown;

    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(url, {
          method: "GET",
          headers: {
            "Content-Type": "application/json"
          },
          signal: controller.signal
        });

        if (!response.ok) {
          const shouldRetry = response.status >= 500 && attempt < this.maxRetries;
          if (shouldRetry) {
            await sleep(100 * (attempt + 1));
            continue;
          }
          throw new Error(`WBS lookup failed: HTTP ${response.status}`);
        }

        const parsed = await parseJsonResponse<WbsLookupResponse>(response);
        return {
          status: parsed?.status,
          customer_entity_id: parsed?.customer_entity_id,
          returned_attributes: parsed?.returned_attributes
        };
      } catch (error) {
        lastError = error;
        if (attempt < this.maxRetries) {
          await sleep(100 * (attempt + 1));
          continue;
        }
      } finally {
        clearTimeout(timeout);
      }
    }

    throw new Error(`WBS lookup failed after retries: ${String(lastError)}`);
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

export const createMeiroAdapter = (
  mode: "mock" | "real",
  config: RealMeiroAdapterConfig,
  seedProfiles: MeiroProfile[] = mockProfiles
): MeiroAdapter => {
  if (mode === "real") {
    return new RealMeiroAdapter(config);
  }
  return new MockMeiroAdapter(seedProfiles);
};

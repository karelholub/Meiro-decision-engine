export * from "./mcp";

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

export type MeiroCampaignChannel = "email" | "push" | "whatsapp";

export interface MeiroCampaignRecord {
  channel: MeiroCampaignChannel;
  id: string;
  name: string;
  deleted: boolean;
  modifiedAt: string | null;
  lastActivationAt: string | null;
  raw: Record<string, unknown>;
}

export interface MeiroAudienceProfileInput {
  attribute: string;
  value: string;
  categoryId?: string;
}

export interface MeiroAudienceProfileResult {
  status: string | null;
  customerEntityId: string | null;
  returnedAttributes: Record<string, unknown>;
  data: Record<string, unknown>;
  raw: unknown;
}

export interface MeiroAudienceSegmentsInput {
  attribute: string;
  value: string;
  tag?: string;
}

export interface MeiroAudienceSegmentsResult {
  status: string | null;
  segmentIds: string[];
  raw: unknown;
}

export interface MeiroCampaignListInput {
  channel: MeiroCampaignChannel;
  limit?: number;
  offset?: number;
  searchedText?: string;
  includeDeleted?: boolean;
}

export interface MeiroCampaignListResult {
  channel: MeiroCampaignChannel;
  items: MeiroCampaignRecord[];
  total: number;
  selection: {
    limit: number | null;
    offset: number;
    searchedText: string | null;
    includeDeleted: boolean;
  };
  raw: unknown;
}

export interface MeiroCampaignUpdateInput {
  channel: MeiroCampaignChannel;
  campaignId: string;
  body: Record<string, unknown>;
}

export interface MeiroCampaignActivationSettingsInput {
  channel: MeiroCampaignChannel;
  campaignId: string;
  body: Record<string, unknown>;
}

export interface MeiroCampaignManualActivationInput {
  channel: MeiroCampaignChannel;
  campaignId: string;
  segmentIds: Array<string | number>;
}

export interface MeiroCampaignTestActivationInput {
  channel: MeiroCampaignChannel;
  campaignId: string;
  recipients: string[];
  customerId?: string;
}

export interface MeiroCampaignManualActivationResult {
  channel: MeiroCampaignChannel;
  campaignId: string;
  status: string;
  raw: unknown;
}

export interface MeiroCampaignTestActivationResult {
  channel: MeiroCampaignChannel;
  campaignId: string;
  status: string;
  raw: unknown;
}

export interface MeiroAdapter {
  supportsPartialAttributes?: boolean;
  getProfile(profileId: string, options?: { requiredAttributes?: string[] }): Promise<MeiroProfile>;
  writebackOutcome?: (profileId: string, input: MeiroWritebackInput) => Promise<void>;
  getWritebackRecords?: (profileId: string) => MeiroWritebackRecord[];
  writeProfileLabel?: (profileId: string, key: string, value: string) => Promise<void>;
  listCampaigns?: (input: MeiroCampaignListInput) => Promise<MeiroCampaignListResult>;
  getCampaign?: (input: { channel: MeiroCampaignChannel; campaignId: string }) => Promise<MeiroCampaignRecord>;
  updateCampaign?: (input: MeiroCampaignUpdateInput) => Promise<MeiroCampaignRecord>;
  updateCampaignActivationSettings?: (input: MeiroCampaignActivationSettingsInput) => Promise<MeiroCampaignRecord>;
  activateCampaign?: (input: MeiroCampaignManualActivationInput) => Promise<MeiroCampaignManualActivationResult>;
  testCampaign?: (input: MeiroCampaignTestActivationInput) => Promise<MeiroCampaignTestActivationResult>;
  checkApiLogin?: () => Promise<{ ok: boolean; username: string | null; domain: string | null }>;
  getAudienceProfile?: (input: MeiroAudienceProfileInput) => Promise<MeiroAudienceProfileResult>;
  getAudienceSegments?: (input: MeiroAudienceSegmentsInput) => Promise<MeiroAudienceSegmentsResult>;
}

export interface RealMeiroAdapterConfig {
  domain?: string;
  username?: string;
  password?: string;
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
  segmentValue?: string;
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

export interface BuiltWbsLookupRequest {
  url: string;
  query: Record<string, string>;
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

export const buildWbsLookupRequest = (config: WbsInstanceConfig, input: WbsLookupInput): BuiltWbsLookupRequest => {
  const params = new URLSearchParams();
  params.set(config.attributeParamName, input.attribute);
  params.set(config.valueParamName, input.value);

  const segmentValue = input.segmentValue ?? config.defaultSegmentValue ?? undefined;
  if (config.includeSegment && segmentValue) {
    params.set(config.segmentParamName, segmentValue);
  }

  const baseUrl = config.baseUrl.replace(/\/$/, "");
  const queryString = params.toString();
  const url = queryString.length > 0 ? `${baseUrl}?${queryString}` : baseUrl;

  return {
    url,
    query: Object.fromEntries(params.entries())
  };
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

const meiroCampaignCollectionPathByChannel: Record<MeiroCampaignChannel, string> = {
  email: "/emails",
  push: "/push_notifications",
  whatsapp: "/whatsapp_campaigns"
};

const meiroCampaignTrashPathByChannel: Record<MeiroCampaignChannel, string> = {
  email: "/emails/trash",
  push: "/push_notifications/trash",
  whatsapp: "/whatsapp_campaigns/trash"
};

const meiroCampaignWrappedListKeys: Record<MeiroCampaignChannel, string[]> = {
  email: ["emails"],
  push: ["push_notifications"],
  whatsapp: ["whatsapp_campaigns", "trashed_whatsapp"]
};

const meiroCampaignWrappedItemKeys: Record<MeiroCampaignChannel, string[]> = {
  email: ["email"],
  push: ["push_notification"],
  whatsapp: ["whatsapp_campaign"]
};

const meiroCampaignTestRecipientsKeyByChannel: Record<MeiroCampaignChannel, string> = {
  email: "emails",
  push: "registration_tokens",
  whatsapp: "phone_numbers"
};

const resolveCampaignItemPath = (channel: MeiroCampaignChannel, campaignId: string): string => {
  return `${meiroCampaignCollectionPathByChannel[channel]}/${encodeURIComponent(campaignId)}`;
};

const toNullableString = (value: unknown): string | null => {
  return typeof value === "string" ? value : null;
};

const compactCampaignRaw = (raw: Record<string, unknown>, detail: boolean): Record<string, unknown> => {
  if (detail) {
    return { ...raw };
  }

  const compactKeys = [
    "id",
    "name",
    "deleted",
    "modified",
    "last_activation",
    "last_activation_by",
    "campaign_type",
    "context_attribute_id",
    "frequency_cap",
    "schedules",
    "subject",
    "preheader",
    "from_email",
    "reply_to_email",
    "title_template",
    "body_template",
    "url",
    "utm_parameters"
  ];
  return Object.fromEntries(compactKeys.filter((key) => key in raw).map((key) => [key, raw[key]]));
};

const toCampaignRecord = (channel: MeiroCampaignChannel, raw: unknown, options: { detail?: boolean } = {}): MeiroCampaignRecord | null => {
  if (!isRecord(raw)) {
    return null;
  }
  if (typeof raw.id !== "string" || raw.id.trim().length === 0) {
    return null;
  }

  const fallbackName =
    channel === "email"
      ? typeof raw.subject === "string"
        ? raw.subject
        : raw.id
      : channel === "push"
        ? typeof raw.title_template === "string"
          ? raw.title_template
          : raw.id
        : raw.id;

  const name = typeof raw.name === "string" && raw.name.trim().length > 0 ? raw.name : fallbackName;

  return {
    channel,
    id: raw.id,
    name,
    deleted: raw.deleted === true,
    modifiedAt: toNullableString(raw.modified),
    lastActivationAt: toNullableString(raw.last_activation),
    raw: compactCampaignRaw(raw, options.detail === true)
  };
};

const toCampaignRecordList = (channel: MeiroCampaignChannel, payload: unknown): MeiroCampaignRecord[] => {
  if (Array.isArray(payload)) {
    return payload
      .map((entry) => toCampaignRecord(channel, entry))
      .filter((entry): entry is MeiroCampaignRecord => entry !== null);
  }

  if (!isRecord(payload)) {
    return [];
  }

  for (const key of meiroCampaignWrappedListKeys[channel]) {
    const candidate = payload[key];
    if (!Array.isArray(candidate)) {
      continue;
    }
    return candidate
      .map((entry) => toCampaignRecord(channel, entry))
      .filter((entry): entry is MeiroCampaignRecord => entry !== null);
  }

  return [];
};

const toSingleCampaignRecord = (channel: MeiroCampaignChannel, payload: unknown): MeiroCampaignRecord | null => {
  if (!isRecord(payload)) {
    return null;
  }

  for (const key of meiroCampaignWrappedItemKeys[channel]) {
    const candidate = payload[key];
    const parsedCandidate = toCampaignRecord(channel, candidate, { detail: true });
    if (parsedCandidate) {
      return parsedCandidate;
    }
  }

  return toCampaignRecord(channel, payload, { detail: true });
};

const cloneCampaignRecord = (value: MeiroCampaignRecord): MeiroCampaignRecord => {
  return {
    ...value,
    raw: { ...value.raw }
  };
};

const defaultMockCampaignsByChannel = (): Record<MeiroCampaignChannel, MeiroCampaignRecord[]> => {
  const nowIso = new Date().toISOString();
  return {
    email: [
      {
        channel: "email",
        id: "email-cmp-001",
        name: "Welcome Nurture",
        deleted: false,
        modifiedAt: nowIso,
        lastActivationAt: null,
        raw: {
          id: "email-cmp-001",
          name: "Welcome Nurture",
          subject: "Welcome to Meiro",
          deleted: false,
          modified: nowIso
        }
      }
    ],
    push: [
      {
        channel: "push",
        id: "push-cmp-001",
        name: "Flash Sale Push",
        deleted: false,
        modifiedAt: nowIso,
        lastActivationAt: null,
        raw: {
          id: "push-cmp-001",
          name: "Flash Sale Push",
          title_template: "Limited offer",
          deleted: false,
          modified: nowIso
        }
      }
    ],
    whatsapp: [
      {
        channel: "whatsapp",
        id: "wa-cmp-001",
        name: "Abandoned Cart WhatsApp",
        deleted: false,
        modifiedAt: nowIso,
        lastActivationAt: null,
        raw: {
          id: "wa-cmp-001",
          name: "Abandoned Cart WhatsApp",
          deleted: false,
          modified: nowIso
        }
      }
    ]
  };
};

export class MockMeiroAdapter implements MeiroAdapter {
  supportsPartialAttributes = false;
  private readonly profiles: Map<string, MeiroProfile>;
  private readonly writebacks: Map<string, MeiroWritebackRecord[]>;
  private readonly campaignsByChannel: Map<MeiroCampaignChannel, Map<string, MeiroCampaignRecord>>;

  constructor(
    seedProfiles: MeiroProfile[],
    options: {
      campaignsByChannel?: Partial<Record<MeiroCampaignChannel, MeiroCampaignRecord[]>>;
    } = {}
  ) {
    this.profiles = new Map(seedProfiles.map((profile) => [profile.profileId, profile]));
    this.writebacks = new Map();
    const defaults = defaultMockCampaignsByChannel();
    this.campaignsByChannel = new Map(
      (["email", "push", "whatsapp"] as const).map((channel) => {
        const seed = options.campaignsByChannel?.[channel] ?? defaults[channel];
        return [channel, new Map(seed.map((campaign) => [campaign.id, cloneCampaignRecord(campaign)]))];
      })
    );
  }

  async getProfile(profileId: string, options?: { requiredAttributes?: string[] }): Promise<MeiroProfile> {
    const profile = this.profiles.get(profileId);
    if (!profile) {
      throw new Error(`Profile not found: ${profileId}`);
    }
    if (!options?.requiredAttributes || options.requiredAttributes.length === 0) {
      return profile;
    }

    const projected: Record<string, unknown> = {};
    for (const key of options.requiredAttributes) {
      if (Object.prototype.hasOwnProperty.call(profile.attributes, key)) {
        projected[key] = profile.attributes[key];
      }
    }

    return {
      ...profile,
      attributes: projected
    };
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

  async listCampaigns(input: MeiroCampaignListInput): Promise<MeiroCampaignListResult> {
    const campaignStore = this.campaignsByChannel.get(input.channel);
    const items = campaignStore ? [...campaignStore.values()].map((campaign) => cloneCampaignRecord(campaign)) : [];

    const searchedText = input.searchedText?.trim().toLowerCase() ?? "";
    const includeDeleted = input.includeDeleted === true;
    const filtered = items.filter((campaign) => {
      if (!includeDeleted && campaign.deleted) {
        return false;
      }
      if (!searchedText) {
        return true;
      }
      return campaign.name.toLowerCase().includes(searchedText) || campaign.id.toLowerCase().includes(searchedText);
    });

    const offset = input.offset && input.offset > 0 ? input.offset : 0;
    const limit = input.limit && input.limit > 0 ? input.limit : null;
    const paged = limit === null ? filtered.slice(offset) : filtered.slice(offset, offset + limit);

    return {
      channel: input.channel,
      items: paged,
      total: filtered.length,
      selection: {
        limit,
        offset,
        searchedText: searchedText.length > 0 ? input.searchedText ?? null : null,
        includeDeleted
      },
      raw: { source: "mock", total: filtered.length }
    };
  }

  async getCampaign(input: { channel: MeiroCampaignChannel; campaignId: string }): Promise<MeiroCampaignRecord> {
    const campaignStore = this.campaignsByChannel.get(input.channel);
    const found = campaignStore?.get(input.campaignId);
    if (!found) {
      throw new Error(`Campaign not found: ${input.channel}/${input.campaignId}`);
    }
    return cloneCampaignRecord(found);
  }

  async updateCampaign(input: MeiroCampaignUpdateInput): Promise<MeiroCampaignRecord> {
    const campaignStore = this.campaignsByChannel.get(input.channel);
    if (!campaignStore) {
      throw new Error(`Unsupported campaign channel: ${input.channel}`);
    }
    const found = campaignStore.get(input.campaignId);
    if (!found) {
      throw new Error(`Campaign not found: ${input.channel}/${input.campaignId}`);
    }

    const nowIso = new Date().toISOString();
    const nextName = typeof input.body.name === "string" && input.body.name.trim().length > 0 ? input.body.name : found.name;
    const updated: MeiroCampaignRecord = {
      ...found,
      name: nextName,
      deleted: typeof input.body.deleted === "boolean" ? input.body.deleted : found.deleted,
      modifiedAt: nowIso,
      raw: {
        ...found.raw,
        ...input.body,
        id: found.id,
        name: nextName,
        modified: nowIso
      }
    };
    campaignStore.set(updated.id, updated);
    return cloneCampaignRecord(updated);
  }

  async updateCampaignActivationSettings(input: MeiroCampaignActivationSettingsInput): Promise<MeiroCampaignRecord> {
    if (input.channel !== "whatsapp") {
      throw new Error("Activation settings are currently supported only for WhatsApp campaigns.");
    }
    return this.updateCampaign({
      channel: input.channel,
      campaignId: input.campaignId,
      body: input.body
    });
  }

  async activateCampaign(input: MeiroCampaignManualActivationInput): Promise<MeiroCampaignManualActivationResult> {
    const updated = await this.updateCampaign({
      channel: input.channel,
      campaignId: input.campaignId,
      body: {
        last_activation: new Date().toISOString()
      }
    });

    return {
      channel: input.channel,
      campaignId: input.campaignId,
      status: "queued",
      raw: {
        message: "ok",
        segment_ids: input.segmentIds,
        campaign: updated.raw
      }
    };
  }

  async testCampaign(input: MeiroCampaignTestActivationInput): Promise<MeiroCampaignTestActivationResult> {
    await this.getCampaign({
      channel: input.channel,
      campaignId: input.campaignId
    });

    return {
      channel: input.channel,
      campaignId: input.campaignId,
      status: "ok",
      raw: {
        message: "ok",
        recipients: input.recipients,
        ...(input.customerId ? { customer_id: input.customerId } : {})
      }
    };
  }
}

export class RealMeiroAdapter implements MeiroAdapter {
  supportsPartialAttributes = true;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private tokenCache: { token: string; generatedAt: number } | null = null;

  constructor(private readonly config: RealMeiroAdapterConfig) {
    this.timeoutMs = config.timeoutMs ?? 15_000;
    this.maxRetries = config.maxRetries ?? 1;
  }

  private resolveDomain(): string {
    const domain = this.config.domain ?? (this.config.baseUrl ? new URL(this.config.baseUrl).origin : undefined);
    if (!domain) {
      throw new Error("MEIRO_DOMAIN is not configured.");
    }
    return domain.replace(/\/$/, "");
  }

  private resolveApiBaseUrl(): string {
    if (this.config.baseUrl && this.config.baseUrl.trim().length > 0) {
      return this.config.baseUrl.replace(/\/$/, "");
    }
    return `${this.resolveDomain()}/api`;
  }

  private async getToken(): Promise<string> {
    if (this.config.token && this.config.token.trim().length > 0) {
      return this.config.token;
    }
    if (this.tokenCache && Date.now() - this.tokenCache.generatedAt < 55 * 60 * 1000) {
      return this.tokenCache.token;
    }
    if (!this.config.username || !this.config.password) {
      throw new Error("MEIRO_USERNAME/MEIRO_PASSWORD are not configured.");
    }

    const response = await fetch(`${this.resolveDomain()}/api/users/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        email: this.config.username,
        password: this.config.password
      })
    });
    const payload = await parseJsonResponse<{ token?: string; message?: string }>(response);
    if (!response.ok || !payload?.token) {
      throw new Error(payload?.message ?? `Meiro login failed: HTTP ${response.status}`);
    }
    this.tokenCache = {
      token: payload.token,
      generatedAt: Date.now()
    };
    return payload.token;
  }

  private async requestWithRetries<T>(input: {
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    url: string;
    body?: Record<string, unknown>;
    token?: string;
  }): Promise<T> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const token = input.token ?? (await this.getToken());
        const response = await fetch(input.url, {
          method: input.method,
          headers: {
            "X-Access-Token": token,
            Authorization: `Bearer ${token}`,
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
          const parsed = await parseJsonResponse<{ message?: string }>(response);
          throw new Error(parsed?.message ?? `Meiro request failed: HTTP ${response.status}`);
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

  private buildApiUrl(path: string, query?: URLSearchParams): string {
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    const queryString = query?.toString();
    return `${this.resolveApiBaseUrl()}${normalizedPath}${queryString ? `?${queryString}` : ""}`;
  }

  private buildAudienceUrl(path: string, query: URLSearchParams): string {
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    return `${this.resolveDomain()}${normalizedPath}?${query.toString()}`;
  }

  async checkApiLogin(): Promise<{ ok: boolean; username: string | null; domain: string | null }> {
    await this.getToken();
    return {
      ok: true,
      username: this.config.username ?? null,
      domain: this.resolveDomain()
    };
  }

  private async fetchProfilePayload(profileId: string, requiredAttributes?: string[]): Promise<MeiroProfileApiPayload> {
    const query = new URLSearchParams();
    if (requiredAttributes && requiredAttributes.length > 0) {
      query.set("attributes", requiredAttributes.join(","));
    }
    const url = this.buildApiUrl(`/profiles/${encodeURIComponent(profileId)}`, query);
    return this.requestWithRetries<MeiroProfileApiPayload>({
      method: "GET",
      url
    });
  }

  async getProfile(profileId: string, options?: { requiredAttributes?: string[] }): Promise<MeiroProfile> {
    const required = options?.requiredAttributes?.filter((value) => value.trim().length > 0) ?? [];

    let payload: MeiroProfileApiPayload;
    if (required.length === 0) {
      payload = await this.fetchProfilePayload(profileId);
    } else {
      try {
        payload = await this.fetchProfilePayload(profileId, required);
      } catch {
        // Backward-compatible fallback for adapters/endpoints that do not support attribute projection.
        payload = await this.fetchProfilePayload(profileId);
      }
    }

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
    const endpoint =
      input.mode === "label"
        ? this.buildApiUrl(`/profiles/${encodeURIComponent(profileId)}/labels`)
        : this.buildApiUrl(`/profiles/${encodeURIComponent(profileId)}/attributes`);

    // TODO: Confirm exact writeback endpoint and payload contract with Meiro CDP.
    await this.requestWithRetries({
      method: "POST",
      url: endpoint,
      body: {
        key: input.key,
        value: input.value,
        ttlDays: input.ttlDays
      }
    });
  }

  async listCampaigns(input: MeiroCampaignListInput): Promise<MeiroCampaignListResult> {
    const query = new URLSearchParams();
    if (typeof input.limit === "number" && input.limit > 0) {
      query.set("limit", String(input.limit));
    }
    if (typeof input.offset === "number" && input.offset >= 0) {
      query.set("offset", String(input.offset));
    }
    if (input.searchedText && input.searchedText.trim().length > 0) {
      query.set("searched_text", input.searchedText.trim());
    }

    const endpoint = input.includeDeleted ? meiroCampaignTrashPathByChannel[input.channel] : meiroCampaignCollectionPathByChannel[input.channel];
    const payload = await this.requestWithRetries<unknown>({
      method: "GET",
      url: this.buildApiUrl(endpoint, query)
    });

    const allItems = toCampaignRecordList(input.channel, payload);
    const searchedText = input.searchedText?.trim().toLowerCase() ?? "";
    const includeDeleted = input.includeDeleted === true;
    const filteredItems = allItems.filter((item) => {
      if (!includeDeleted && item.deleted) {
        return false;
      }
      if (!searchedText) {
        return true;
      }
      return item.name.toLowerCase().includes(searchedText) || item.id.toLowerCase().includes(searchedText);
    });

    const offset = typeof input.offset === "number" && input.offset > 0 ? input.offset : 0;
    const limit = typeof input.limit === "number" && input.limit > 0 ? input.limit : null;
    const paged = limit === null ? filteredItems.slice(offset) : filteredItems.slice(offset, offset + limit);

    return {
      channel: input.channel,
      items: paged,
      total: filteredItems.length,
      selection: {
        limit,
        offset,
        searchedText: searchedText.length > 0 ? input.searchedText ?? null : null,
        includeDeleted
      },
      raw: payload
    };
  }

  async getCampaign(input: { channel: MeiroCampaignChannel; campaignId: string }): Promise<MeiroCampaignRecord> {
    const payload = await this.requestWithRetries<unknown>({
      method: "GET",
      url: this.buildApiUrl(resolveCampaignItemPath(input.channel, input.campaignId))
    });

    const parsed = toSingleCampaignRecord(input.channel, payload);
    if (!parsed) {
      throw new Error(`Meiro campaign not found: ${input.channel}/${input.campaignId}`);
    }
    return parsed;
  }

  async updateCampaign(input: MeiroCampaignUpdateInput): Promise<MeiroCampaignRecord> {
    const payload = await this.requestWithRetries<unknown>({
      method: "PATCH",
      url: this.buildApiUrl(resolveCampaignItemPath(input.channel, input.campaignId)),
      body: input.body
    });

    const parsed = toSingleCampaignRecord(input.channel, payload);
    if (!parsed) {
      throw new Error(`Unexpected Meiro campaign response for ${input.channel}/${input.campaignId}`);
    }
    return parsed;
  }

  async updateCampaignActivationSettings(input: MeiroCampaignActivationSettingsInput): Promise<MeiroCampaignRecord> {
    if (input.channel !== "whatsapp") {
      throw new Error("Activation settings are currently supported only for WhatsApp campaigns.");
    }
    const payload = await this.requestWithRetries<unknown>({
      method: "PUT",
      url: this.buildApiUrl(`/whatsapp_campaigns/activation/settings/${encodeURIComponent(input.campaignId)}`),
      body: input.body
    });

    const parsed = toSingleCampaignRecord(input.channel, payload);
    if (!parsed) {
      throw new Error(`Unexpected Meiro activation-settings response for ${input.channel}/${input.campaignId}`);
    }
    return parsed;
  }

  async activateCampaign(input: MeiroCampaignManualActivationInput): Promise<MeiroCampaignManualActivationResult> {
    const payload = await this.requestWithRetries<unknown>({
      method: "POST",
      url: this.buildApiUrl(`${resolveCampaignItemPath(input.channel, input.campaignId)}/manual_activation`),
      body: {
        segment_ids: input.segmentIds
      }
    });

    return {
      channel: input.channel,
      campaignId: input.campaignId,
      status: "queued",
      raw: payload
    };
  }

  async testCampaign(input: MeiroCampaignTestActivationInput): Promise<MeiroCampaignTestActivationResult> {
    const recipientsKey = meiroCampaignTestRecipientsKeyByChannel[input.channel];
    const payload = await this.requestWithRetries<unknown>({
      method: "POST",
      url: this.buildApiUrl(`${resolveCampaignItemPath(input.channel, input.campaignId)}/activations`),
      body: {
        [recipientsKey]: input.recipients,
        ...(input.customerId ? { customer_id: input.customerId } : {})
      }
    });

    const status = isRecord(payload) && typeof payload.message === "string" ? payload.message : "ok";
    return {
      channel: input.channel,
      campaignId: input.campaignId,
      status,
      raw: payload
    };
  }

  async getAudienceProfile(input: MeiroAudienceProfileInput): Promise<MeiroAudienceProfileResult> {
    const query = new URLSearchParams();
    query.set("attribute", input.attribute);
    query.set("value", input.value);
    if (input.categoryId && input.categoryId.trim().length > 0) {
      query.set("category_id", input.categoryId.trim());
    }
    const payload = await this.requestPublicJson<unknown>(this.buildAudienceUrl("/wbs", query));
    return {
      status: isRecord(payload) && typeof payload.status === "string" ? payload.status : null,
      customerEntityId: isRecord(payload) && typeof payload.customer_entity_id === "string" ? payload.customer_entity_id : null,
      returnedAttributes: isRecord(payload) && isRecord(payload.returned_attributes) ? payload.returned_attributes : {},
      data: isRecord(payload) && isRecord(payload.data) ? payload.data : {},
      raw: payload
    };
  }

  async getAudienceSegments(input: MeiroAudienceSegmentsInput): Promise<MeiroAudienceSegmentsResult> {
    const query = new URLSearchParams();
    query.set("attribute", input.attribute);
    query.set("value", input.value);
    if (input.tag && input.tag.trim().length > 0) {
      query.set("tag", input.tag.trim());
    }
    const payload = await this.requestPublicJson<unknown>(this.buildAudienceUrl("/wbs/segments", query));
    const rawSegmentIds = isRecord(payload) && Array.isArray(payload.segment_ids) ? payload.segment_ids : [];
    return {
      status: isRecord(payload) && typeof payload.status === "string" ? payload.status : null,
      segmentIds: rawSegmentIds.map((item) => String(item)),
      raw: payload
    };
  }

  private async requestPublicJson<T>(url: string): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          Accept: "application/json"
        },
        signal: controller.signal
      });
      const payload = await parseJsonResponse<T & { message?: string }>(response);
      if (!response.ok) {
        throw new Error(payload?.message ?? `Meiro Audience API request failed: HTTP ${response.status}`);
      }
      return payload as T;
    } finally {
      clearTimeout(timeout);
    }
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
    const request = buildWbsLookupRequest(config, input);
    const url = request.url;
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

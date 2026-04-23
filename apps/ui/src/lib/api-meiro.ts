import { apiFetch, toQuery } from "./api-core";
import type {
  MeiroApiStatusResponse,
  MeiroAudienceProfileResponse,
  MeiroAudienceSegmentsResponse,
  MeiroCampaignActionResponse,
  MeiroCampaignChannel,
  MeiroCampaignListResponse,
  MeiroCampaignRecord,
  MeiroMcpCheckResponse,
  MeiroMcpAttribute,
  MeiroMcpCustomerAttributes,
  MeiroMcpCustomerSearchResult,
  MeiroMcpDataListResponse,
  MeiroMcpEvent,
  MeiroMcpFunnelGroup,
  MeiroMcpSegment,
  MeiroMcpStatusResponse,
  MeiroMcpToolCallResponse,
  MeiroMcpToolsResponse
} from "./api-types";

export const meiroApiClient = {
  meiro: {
    api: {
      status: () => apiFetch<MeiroApiStatusResponse>("/v1/meiro/api/status"),
      checkLogin: () =>
        apiFetch<MeiroApiStatusResponse>("/v1/meiro/api/check-login", {
          method: "POST"
        })
    },
    audience: {
      profile: (params: { attribute: string; value: string; categoryId?: string }) =>
        apiFetch<MeiroAudienceProfileResponse>(`/v1/meiro/audience/profile${toQuery(params)}`),
      segments: (params: { attribute: string; value: string; tag?: string }) =>
        apiFetch<MeiroAudienceSegmentsResponse>(`/v1/meiro/audience/segments${toQuery(params)}`)
    },
    nativeCampaigns: {
      list: (params: {
        channel: MeiroCampaignChannel;
        limit?: number;
        offset?: number;
        q?: string;
        includeDeleted?: boolean;
      }) => apiFetch<MeiroCampaignListResponse>(`/v1/meiro/native-campaigns${toQuery(params)}`),
      get: (channel: MeiroCampaignChannel, id: string) =>
        apiFetch<{ item: MeiroCampaignRecord; source: "meiro_api" }>(`/v1/meiro/native-campaigns/${channel}/${encodeURIComponent(id)}`),
      update: (channel: MeiroCampaignChannel, id: string, body: Record<string, unknown>) =>
        apiFetch<{ item: MeiroCampaignRecord; source: "meiro_api" }>(`/v1/meiro/native-campaigns/${channel}/${encodeURIComponent(id)}`, {
          method: "PATCH",
          body: JSON.stringify(body)
        }),
      updateActivationSettings: (channel: MeiroCampaignChannel, id: string, body: Record<string, unknown>) =>
        apiFetch<{ item: MeiroCampaignRecord; source: "meiro_api" }>(`/v1/meiro/native-campaigns/${channel}/${encodeURIComponent(id)}/activation-settings`, {
          method: "PUT",
          body: JSON.stringify(body)
        }),
      manualActivate: (channel: MeiroCampaignChannel, id: string, segmentIds: Array<string | number>) =>
        apiFetch<MeiroCampaignActionResponse>(`/v1/meiro/native-campaigns/${channel}/${encodeURIComponent(id)}/manual-activation`, {
          method: "POST",
          body: JSON.stringify({ segmentIds })
        }),
      testActivate: (channel: MeiroCampaignChannel, id: string, recipients: string[], customerId?: string) =>
        apiFetch<MeiroCampaignActionResponse>(`/v1/meiro/native-campaigns/${channel}/${encodeURIComponent(id)}/test-activation`, {
          method: "POST",
          body: JSON.stringify({ recipients, ...(customerId ? { customerId } : {}) })
        })
    },
    campaigns: {
      list: (params: {
        channel: MeiroCampaignChannel;
        limit?: number;
        offset?: number;
        q?: string;
        includeDeleted?: boolean;
      }) => apiFetch<MeiroCampaignListResponse>(`/v1/meiro/campaigns${toQuery(params)}`),
      get: (channel: MeiroCampaignChannel, id: string) =>
        apiFetch<{ item: MeiroCampaignRecord }>(`/v1/meiro/campaigns/${channel}/${encodeURIComponent(id)}`),
      update: (channel: MeiroCampaignChannel, id: string, body: Record<string, unknown>) =>
        apiFetch<{ item: MeiroCampaignRecord }>(`/v1/meiro/campaigns/${channel}/${encodeURIComponent(id)}`, {
          method: "PATCH",
          body: JSON.stringify(body)
        }),
      updateActivationSettings: (channel: MeiroCampaignChannel, id: string, body: Record<string, unknown>) =>
        apiFetch<{ item: MeiroCampaignRecord }>(`/v1/meiro/campaigns/${channel}/${encodeURIComponent(id)}/activation-settings`, {
          method: "PUT",
          body: JSON.stringify(body)
        }),
      manualActivate: (channel: MeiroCampaignChannel, id: string, segmentIds: Array<string | number>) =>
        apiFetch<MeiroCampaignActionResponse>(`/v1/meiro/campaigns/${channel}/${encodeURIComponent(id)}/manual-activation`, {
          method: "POST",
          body: JSON.stringify({ segmentIds })
        }),
      testActivate: (channel: MeiroCampaignChannel, id: string, recipients: string[], customerId?: string) =>
        apiFetch<MeiroCampaignActionResponse>(`/v1/meiro/campaigns/${channel}/${encodeURIComponent(id)}/test-activation`, {
          method: "POST",
          body: JSON.stringify({ recipients, ...(customerId ? { customerId } : {}) })
        })
    },
    mcp: {
      status: () => apiFetch<MeiroMcpStatusResponse>("/v1/meiro/mcp/status"),
      check: () =>
        apiFetch<MeiroMcpCheckResponse>("/v1/meiro/mcp/check", {
          method: "POST"
        }),
      tools: () => apiFetch<MeiroMcpToolsResponse>("/v1/meiro/mcp/tools"),
      callTool: (name: string, args: Record<string, unknown>) =>
        apiFetch<MeiroMcpToolCallResponse>(`/v1/meiro/mcp/tools/${encodeURIComponent(name)}/call`, {
          method: "POST",
          body: JSON.stringify({ arguments: args })
        }),
      segments: (params: { optional?: boolean } = { optional: true }) =>
        apiFetch<MeiroMcpDataListResponse<MeiroMcpSegment>>(`/v1/meiro/mcp/data/segments${toQuery(params)}`),
      segmentDetails: (id: string | number) =>
        apiFetch<{ item: MeiroMcpSegment | null; details: unknown; cached?: boolean; source: "meiro_mcp" }>(
          `/v1/meiro/mcp/data/segments/${encodeURIComponent(String(id))}`
        ),
      attributes: (params: { optional?: boolean } = { optional: true }) =>
        apiFetch<MeiroMcpDataListResponse<MeiroMcpAttribute>>(`/v1/meiro/mcp/data/attributes${toQuery(params)}`),
      events: (params: { optional?: boolean } = { optional: true }) =>
        apiFetch<MeiroMcpDataListResponse<MeiroMcpEvent>>(`/v1/meiro/mcp/data/events${toQuery(params)}`),
      funnels: (params: { optional?: boolean } = { optional: true }) =>
        apiFetch<MeiroMcpDataListResponse<MeiroMcpFunnelGroup>>(`/v1/meiro/mcp/data/funnels${toQuery(params)}`),
      funnelGroupData: (id: string, params: { startDate: string; endDate: string; segmentId?: string }) =>
        apiFetch<{ item: unknown; source: "meiro_mcp" }>(
          `/v1/meiro/mcp/data/funnels/${encodeURIComponent(id)}/groups${toQuery(params)}`
        ),
      searchCustomers: (q: string, limit = 10) =>
        apiFetch<MeiroMcpDataListResponse<MeiroMcpCustomerSearchResult>>(
          `/v1/meiro/mcp/data/customers/search${toQuery({ q, limit })}`
        ),
      customerAttributes: (id: string) =>
        apiFetch<{ item: MeiroMcpCustomerAttributes; source: "meiro_mcp" }>(
          `/v1/meiro/mcp/data/customers/${encodeURIComponent(id)}/attributes`
        )
    }
  }
};

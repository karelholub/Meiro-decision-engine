import { afterEach, describe, expect, it, vi } from "vitest";

import { catalogApiClient } from "./api-catalog";
import { decisioningApiClient } from "./api-decisioning";
import { inAppApiClient } from "./api-inapp";
import { meiroApiClient } from "./api-meiro";
import { operationsApiClient } from "./api-operations";

const stubJsonFetch = (payload: unknown = {}) => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

const firstFetchUrl = (fetchMock: ReturnType<typeof stubJsonFetch>) => {
  const call = fetchMock.mock.calls.at(0);
  expect(call).toBeDefined();
  return String(call?.[0]);
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("domain api clients", () => {
  it("keeps decisioning routes in the decisioning client", async () => {
    const fetchMock = stubJsonFetch({ items: [], page: 1, limit: 20, total: 0, totalPages: 0 });

    await decisioningApiClient.decisions.list({ status: "DRAFT", q: "cart", page: 2 });

    expect(firstFetchUrl(fetchMock)).toBe("http://localhost:3001/v1/decisions?status=DRAFT&q=cart&page=2");
  });

  it("keeps catalog routes in the catalog client", async () => {
    const fetchMock = stubJsonFetch({ generatedAt: "now", context: {}, items: [], rejected: [] });

    await catalogApiClient.library.picker({ channel: "email", includeUnready: true });

    expect(firstFetchUrl(fetchMock)).toBe("http://localhost:3001/v1/catalog/library/picker?channel=email&includeUnready=true");
  });

  it("keeps in-app routes in the in-app client", async () => {
    const fetchMock = stubJsonFetch({
      environment: "DEV",
      stream: { key: "events", length: 0, pending: 0, lag: null },
      worker: null
    });

    await inAppApiClient.inapp.v2.monitor();

    expect(firstFetchUrl(fetchMock)).toBe("http://localhost:3001/v2/inapp/events/monitor");
  });

  it("keeps Meiro campaign routes in the Meiro client", async () => {
    const fetchMock = stubJsonFetch({ channel: "email", total: 0, selection: {}, items: [] });

    await meiroApiClient.meiro.campaigns.list({ channel: "email", q: "welcome", limit: 25 });

    expect(firstFetchUrl(fetchMock)).toBe("http://localhost:3001/v1/meiro/campaigns?channel=email&q=welcome&limit=25");
  });

  it("keeps typed Meiro MCP data routes in the Meiro client", async () => {
    const fetchMock = stubJsonFetch({ items: [] });

    await meiroApiClient.meiro.mcp.searchCustomers("buyer@example.com", 5);

    expect(firstFetchUrl(fetchMock)).toBe(
      "http://localhost:3001/v1/meiro/mcp/data/customers/search?q=buyer%40example.com&limit=5"
    );
  });

  it("keeps live Meiro API routes in the Meiro client", async () => {
    const fetchMock = stubJsonFetch({ status: "ok", customerEntityId: "cust-1", returnedAttributes: {}, data: {} });

    await meiroApiClient.meiro.audience.profile({
      attribute: "stitching_meiro_id",
      value: "cust-1",
      categoryId: "accessories"
    });

    expect(firstFetchUrl(fetchMock)).toBe(
      "http://localhost:3001/v1/meiro/audience/profile?attribute=stitching_meiro_id&value=cust-1&categoryId=accessories"
    );
  });

  it("keeps native Meiro campaign routes separate from mock campaign routes", async () => {
    const fetchMock = stubJsonFetch({ channel: "email", total: 0, selection: {}, items: [] });

    await meiroApiClient.meiro.nativeCampaigns.list({ channel: "email", limit: 10 });

    expect(firstFetchUrl(fetchMock)).toBe("http://localhost:3001/v1/meiro/native-campaigns?channel=email&limit=10");
  });

  it("keeps operations routes and parameter normalization in the operations client", async () => {
    const fetchMock = stubJsonFetch({ item: null });

    await operationsApiClient.execution.results.latest({
      mode: "decision",
      key: " checkout ",
      lookupAttribute: " email ",
      lookupValue: "buyer@example.com "
    });

    expect(firstFetchUrl(fetchMock)).toBe(
      "http://localhost:3001/v1/results/latest?mode=decision&key=checkout&lookupAttribute=email&lookupValue=buyer%40example.com"
    );
  });
});

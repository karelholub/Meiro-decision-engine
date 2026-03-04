import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiClient } from "./api";
import { __getRegistryCacheEntryForTests, __resetRegistryCacheForTests, loadRegistryCacheEntry } from "./registry";

describe("registry cache", () => {
  beforeEach(() => {
    __resetRegistryCacheForTests();
    vi.restoreAllMocks();

    vi.spyOn(apiClient.catalog.offers, "list").mockResolvedValue({ items: [] });
    vi.spyOn(apiClient.catalog.content, "list").mockResolvedValue({ items: [] });
    vi.spyOn(apiClient.inapp.templates, "list").mockResolvedValue({ items: [] });
    vi.spyOn(apiClient.inapp.placements, "list").mockResolvedValue({ items: [] });
    vi.spyOn(apiClient.inapp.apps, "list").mockResolvedValue({ items: [] });
    vi.spyOn(apiClient.experiments, "list").mockResolvedValue({ items: [] });
    vi.spyOn(apiClient.inapp.campaigns, "list").mockResolvedValue({ items: [] });
    vi.spyOn(apiClient.decisions, "list").mockResolvedValue({ items: [], page: 1, limit: 200, total: 0, totalPages: 0 });
    vi.spyOn(apiClient.stacks, "list").mockResolvedValue({ items: [], page: 1, limit: 200, total: 0, totalPages: 0 });
    vi.spyOn(apiClient.execution.orchestration, "listPolicies").mockResolvedValue({ items: [] });
  });

  it("dedupes loads while cache is fresh", async () => {
    await loadRegistryCacheEntry({ env: "DEV" });
    await loadRegistryCacheEntry({ env: "DEV" });

    expect(apiClient.catalog.offers.list).toHaveBeenCalledTimes(1);
    const entry = __getRegistryCacheEntryForTests("DEV");
    expect(entry?.loadedAt).toBeTypeOf("number");
    expect(entry?.expiresAt).toBeGreaterThan(entry?.loadedAt ?? 0);
  });

  it("supports force reload", async () => {
    await loadRegistryCacheEntry({ env: "DEV" });
    await loadRegistryCacheEntry({ env: "DEV", force: true });
    expect(apiClient.catalog.offers.list).toHaveBeenCalledTimes(2);
  });

  it("separates cache by environment and appKey", async () => {
    await loadRegistryCacheEntry({ env: "DEV" });
    await loadRegistryCacheEntry({ env: "STAGE" });
    await loadRegistryCacheEntry({ env: "DEV", appKey: "mobile" });

    expect(__getRegistryCacheEntryForTests("DEV")).not.toBeNull();
    expect(__getRegistryCacheEntryForTests("STAGE")).not.toBeNull();
    expect(__getRegistryCacheEntryForTests("DEV", "mobile")).not.toBeNull();
  });
});

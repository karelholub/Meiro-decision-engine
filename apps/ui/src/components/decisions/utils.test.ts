import { afterEach, describe, expect, it } from "vitest";
import type { DecisionVersionSummary } from "@decisioning/shared";
import {
  buildDecisionSummaries,
  getDecisionListViewPreference,
  getVirtualWindow,
  resolveDecisionListView,
  setDecisionListViewPreference,
  shouldVirtualizeDecisions,
  sortDecisionSummaries
} from "./utils";

const makeVersion = (input: Partial<DecisionVersionSummary> & { decisionId: string; versionId: string; key: string; version: number; status: DecisionVersionSummary["status"] }): DecisionVersionSummary => ({
  decisionId: input.decisionId,
  versionId: input.versionId,
  key: input.key,
  environment: input.environment ?? "DEV",
  name: input.name ?? input.key,
  description: input.description ?? "",
  version: input.version,
  status: input.status,
  updatedAt: input.updatedAt ?? new Date("2026-01-01T00:00:00Z").toISOString(),
  activatedAt: input.activatedAt ?? null
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe("decision summaries", () => {
  it("aggregates active + draft + archived into ACTIVE_WITH_DRAFT", () => {
    const summaries = buildDecisionSummaries([
      makeVersion({ decisionId: "d1", versionId: "1", key: "cart_recovery", version: 1, status: "ARCHIVED", updatedAt: "2026-01-01T10:00:00Z" }),
      makeVersion({ decisionId: "d1", versionId: "2", key: "cart_recovery", version: 2, status: "ACTIVE", updatedAt: "2026-01-02T10:00:00Z", activatedAt: "2026-01-02T10:30:00Z" }),
      makeVersion({ decisionId: "d1", versionId: "3", key: "cart_recovery", version: 3, status: "DRAFT", updatedAt: "2026-01-03T10:00:00Z" })
    ]);

    expect(summaries).toHaveLength(1);
    expect(summaries[0]?.status).toBe("ACTIVE_WITH_DRAFT");
    expect(summaries[0]?.activeVersion?.version).toBe(2);
    expect(summaries[0]?.draftVersion?.version).toBe(3);
    expect(summaries[0]?.latestUpdatedAt).toBe("2026-01-03T10:00:00Z");
    expect(summaries[0]?.hasArchived).toBe(true);
  });

  it("derives DRAFT_ONLY and ARCHIVED_ONLY correctly", () => {
    const summaries = buildDecisionSummaries([
      makeVersion({ decisionId: "d2", versionId: "21", key: "draft_only", version: 2, status: "DRAFT", updatedAt: "2026-01-05T00:00:00Z" }),
      makeVersion({ decisionId: "d3", versionId: "31", key: "arch_only", version: 1, status: "ARCHIVED", updatedAt: "2026-01-04T00:00:00Z" })
    ]);

    const draftOnly = summaries.find((item) => item.key === "draft_only");
    const archivedOnly = summaries.find((item) => item.key === "arch_only");
    expect(draftOnly?.status).toBe("DRAFT_ONLY");
    expect(archivedOnly?.status).toBe("ARCHIVED_ONLY");
  });

  it("sorts by updated descending by default", () => {
    const summaries = buildDecisionSummaries([
      makeVersion({ decisionId: "d4", versionId: "41", key: "older", version: 1, status: "ACTIVE", updatedAt: "2026-01-01T00:00:00Z" }),
      makeVersion({ decisionId: "d5", versionId: "51", key: "newer", version: 1, status: "ACTIVE", updatedAt: "2026-01-10T00:00:00Z" })
    ]);

    const sorted = sortDecisionSummaries(summaries, "updated", "desc");
    expect(sorted.map((item) => item.key)).toEqual(["newer", "older"]);
  });
});

describe("view preference", () => {
  it("persists compact/expanded preference in localStorage", () => {
    const store = new Map<string, string>();
    (globalThis as { window: Window & typeof globalThis }).window = {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => {
          store.set(key, value);
        },
        removeItem: (key: string) => {
          store.delete(key);
        },
        clear: () => {
          store.clear();
        },
        key: () => null,
        length: 0
      }
    } as unknown as Window & typeof globalThis;

    expect(getDecisionListViewPreference("DEV")).toBeNull();
    setDecisionListViewPreference("DEV", "compact");
    expect(getDecisionListViewPreference("DEV")).toBe("compact");
    expect(resolveDecisionListView("DEV", 5)).toBe("compact");
  });

  it("defaults to compact when count is high and no preference exists", () => {
    expect(resolveDecisionListView("DEV", 200)).toBe("compact");
  });
});

describe("virtualization", () => {
  it("enables virtualization for large lists and computes bounded windows", () => {
    expect(shouldVirtualizeDecisions(500)).toBe(true);
    expect(shouldVirtualizeDecisions(80)).toBe(false);

    const window = getVirtualWindow({
      count: 500,
      rowHeight: 64,
      viewportHeight: 560,
      scrollTop: 640
    });

    expect(window.start).toBeGreaterThanOrEqual(0);
    expect(window.end).toBeLessThanOrEqual(500);
    expect(window.end - window.start).toBeLessThan(500);
  });
});

import React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DecisionsCompactTable } from "./DecisionsCompactTable";
import type { DecisionSummary } from "./utils";

const makeSummary = (input: Partial<DecisionSummary> & { decisionId: string; key: string; name: string }): DecisionSummary => ({
  decisionId: input.decisionId,
  key: input.key,
  name: input.name,
  environment: "DEV",
  versions: [],
  activeVersion: input.activeVersion,
  draftVersion: input.draftVersion,
  latestUpdatedAt: input.latestUpdatedAt ?? new Date("2026-01-01T00:00:00Z").toISOString(),
  hasArchived: input.hasArchived ?? false,
  status: input.status ?? "ACTIVE"
});

describe("DecisionsCompactTable", () => {
  it("renders compact rows with row actions", () => {
    const html = renderToStaticMarkup(
      <DecisionsCompactTable
        summaries={[
          makeSummary({
            decisionId: "d1",
            key: "cart_recovery",
            name: "Cart Recovery",
            activeVersion: { version: 2, updatedAt: "2026-01-02T00:00:00Z", activatedAt: "2026-01-02T00:00:00Z" },
            draftVersion: { version: 3, updatedAt: "2026-01-03T00:00:00Z" },
            status: "ACTIVE_WITH_DRAFT"
          })
        ]}
        canWrite
        canArchive
        canPromote
        onCreateDraft={() => undefined}
        onDuplicateActive={() => undefined}
        onArchive={() => undefined}
        onExportJson={() => undefined}
      />
    );

    expect(html).toContain("Cart Recovery");
    expect(html).toContain("Open");
    expect(html).toContain("Edit draft");
    expect(html).toContain("ACTIVE");
    expect(html).toContain("DRAFT");
  });

  it("marks table as virtualized for large sets", () => {
    const many = Array.from({ length: 500 }).map((_, index) =>
      makeSummary({
        decisionId: `d-${index}`,
        key: `key_${index}`,
        name: `Decision ${index}`,
        activeVersion: { version: 1, updatedAt: "2026-01-01T00:00:00Z", activatedAt: "2026-01-01T00:00:00Z" },
        status: "ACTIVE"
      })
    );

    const html = renderToStaticMarkup(
      <DecisionsCompactTable
        summaries={many}
        canWrite
        canArchive
        canPromote
        onCreateDraft={() => undefined}
        onDuplicateActive={() => undefined}
        onArchive={() => undefined}
        onExportJson={() => undefined}
      />
    );

    expect(html).toContain('data-virtualized="true"');
  });
});

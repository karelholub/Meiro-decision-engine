import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OperationalTableShell } from "./operational-table";
import { PagePanel } from "./page";

describe("shared UI primitives JSX runtime", () => {
  it("server-renders primitives that only import React types", () => {
    const html = renderToStaticMarkup(
      <PagePanel>
        <OperationalTableShell>
          <table>
            <tbody>
              <tr>
                <td>Runtime check</td>
              </tr>
            </tbody>
          </table>
        </OperationalTableShell>
      </PagePanel>
    );

    expect(html).toContain("Runtime check");
    expect(html).toContain("panel");
  });
});

"use client";

import { Button } from "../ui/button";

export type TokenBindingRow = {
  token: string;
  sourcePath: string;
};

type TokenBindingsTableProps = {
  rows: TokenBindingRow[];
  testContext: Record<string, unknown>;
  missing: string[];
  unused: string[];
  onChange: (rows: TokenBindingRow[]) => void;
  readOnly?: boolean;
};

const lookup = (input: Record<string, unknown>, path: string): unknown => {
  return path.split(".").reduce<unknown>((current, segment) => {
    if (!segment) {
      return current;
    }
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return undefined;
    }
    return (current as Record<string, unknown>)[segment];
  }, input);
};

export function TokenBindingsTable({ rows, testContext, missing, unused, onChange, readOnly }: TokenBindingsTableProps) {
  return (
    <section className="panel space-y-3 p-4">
      <h3 className="font-semibold">Token bindings</h3>

      {missing.length > 0 ? <p className="text-xs text-amber-700">Missing bindings: {missing.join(", ")}</p> : null}
      {unused.length > 0 ? <p className="text-xs text-stone-600">Unused bindings: {unused.join(", ")}</p> : null}

      <div className="overflow-auto">
        <table className="min-w-full border-collapse text-sm">
          <thead>
            <tr className="text-left text-stone-600">
              <th className="border-b border-stone-200 pb-1 pr-2">Token name</th>
              <th className="border-b border-stone-200 pb-1 pr-2">Source path</th>
              <th className="border-b border-stone-200 pb-1 pr-2">Test value</th>
              <th className="border-b border-stone-200 pb-1 pr-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={`${index}-${row.token}`}>
                <td className="py-2 pr-2">
                  <input
                    value={row.token}
                    onChange={(event) => {
                      const next = [...rows];
                      const currentRow = next[index] ?? { token: "", sourcePath: "" };
                      next[index] = { ...currentRow, token: event.target.value };
                      onChange(next);
                    }}
                    className="w-full rounded-md border border-stone-300 px-2 py-1"
                    disabled={readOnly}
                    placeholder="offer"
                  />
                </td>
                <td className="py-2 pr-2">
                  <input
                    value={row.sourcePath}
                    onChange={(event) => {
                      const next = [...rows];
                      const currentRow = next[index] ?? { token: "", sourcePath: "" };
                      next[index] = { ...currentRow, sourcePath: event.target.value };
                      onChange(next);
                    }}
                    className="w-full rounded-md border border-stone-300 px-2 py-1"
                    disabled={readOnly}
                    placeholder="context.offer"
                  />
                </td>
                <td className="py-2 pr-2 text-xs text-stone-600">
                  {row.sourcePath.trim() ? JSON.stringify(lookup(testContext, row.sourcePath), null, 0) ?? "-" : "-"}
                </td>
                <td className="py-2">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => onChange(rows.filter((_, rowIndex) => rowIndex !== index))}
                    disabled={readOnly}
                  >
                    Remove
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Button type="button" variant="outline" onClick={() => onChange([...rows, { token: "", sourcePath: "" }])} disabled={readOnly}>
        Add binding
      </Button>
    </section>
  );
}

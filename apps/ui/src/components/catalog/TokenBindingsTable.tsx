"use client";

import { Button } from "../ui/button";
import {
  OperationalTableShell,
  operationalTableCellClassName,
  operationalTableClassName,
  operationalTableHeadClassName,
  operationalTableHeaderCellClassName
} from "../ui/operational-table";
import { inputClassName } from "../ui/page";

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
    <section className="panel space-y-3 p-3">
      <h3 className="font-semibold">Token bindings</h3>

      {missing.length > 0 ? <p className="text-xs text-amber-700">Missing bindings: {missing.join(", ")}</p> : null}
      {unused.length > 0 ? <p className="text-xs text-stone-600">Unused bindings: {unused.join(", ")}</p> : null}

      <OperationalTableShell tableMinWidth="720px">
        <table className={operationalTableClassName}>
          <thead className={operationalTableHeadClassName}>
            <tr>
              <th className={operationalTableHeaderCellClassName}>Token name</th>
              <th className={operationalTableHeaderCellClassName}>Source path</th>
              <th className={operationalTableHeaderCellClassName}>Test value</th>
              <th className={operationalTableHeaderCellClassName} />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={`${index}-${row.token}`}>
                <td className={operationalTableCellClassName}>
                  <input
                    value={row.token}
                    onChange={(event) => {
                      const next = [...rows];
                      const currentRow = next[index] ?? { token: "", sourcePath: "" };
                      next[index] = { ...currentRow, token: event.target.value };
                      onChange(next);
                    }}
                    className={inputClassName}
                    disabled={readOnly}
                    placeholder="offer"
                  />
                </td>
                <td className={operationalTableCellClassName}>
                  <input
                    value={row.sourcePath}
                    onChange={(event) => {
                      const next = [...rows];
                      const currentRow = next[index] ?? { token: "", sourcePath: "" };
                      next[index] = { ...currentRow, sourcePath: event.target.value };
                      onChange(next);
                    }}
                    className={inputClassName}
                    disabled={readOnly}
                    placeholder="context.offer"
                  />
                </td>
                <td className={`${operationalTableCellClassName} text-xs text-stone-600`}>
                  {row.sourcePath.trim() ? JSON.stringify(lookup(testContext, row.sourcePath), null, 0) ?? "-" : "-"}
                </td>
                <td className={operationalTableCellClassName}>
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
      </OperationalTableShell>

      <Button type="button" variant="outline" onClick={() => onChange([...rows, { token: "", sourcePath: "" }])} disabled={readOnly}>
        Add binding
      </Button>
    </section>
  );
}

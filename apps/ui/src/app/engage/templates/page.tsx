"use client";

import { useEffect, useState } from "react";
import type { InAppTemplate } from "@decisioning/shared";
import { apiClient } from "../../../lib/api";
import { getEnvironment, onEnvironmentChange, type UiEnvironment } from "../../../lib/environment";
import { EmptyState, InlineError } from "../../../components/ui/app-state";
import { Button } from "../../../components/ui/button";
import {
  OperationalTableShell,
  operationalTableCellClassName,
  operationalTableClassName,
  operationalTableHeadClassName,
  operationalTableHeaderCellClassName
} from "../../../components/ui/operational-table";
import { FieldLabel, FilterPanel, PageHeader, PagePanel, inputClassName } from "../../../components/ui/page";

const defaultSchema = {
  type: "object",
  required: ["title", "subtitle", "cta", "image", "deeplink"],
  properties: {
    title: { type: "string" },
    subtitle: { type: "string" },
    cta: { type: "string" },
    image: { type: "string" },
    deeplink: { type: "string" }
  }
};

export default function InAppTemplatesPage() {
  const [environment, setEnvironment] = useState<UiEnvironment>("DEV");
  const [items, setItems] = useState<InAppTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [key, setKey] = useState("banner_v1");
  const [name, setName] = useState("Banner v1");
  const [schemaText, setSchemaText] = useState(`${JSON.stringify(defaultSchema, null, 2)}\n`);
  const [validation, setValidation] = useState<{ valid: boolean; errors: string[]; warnings: string[] } | null>(null);

  useEffect(() => {
    setEnvironment(getEnvironment());
    return onEnvironmentChange(setEnvironment);
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      const response = await apiClient.inapp.templates.list();
      setItems(response.items);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load templates");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [environment]);

  const parseSchema = () => {
    return JSON.parse(schemaText) as Record<string, unknown>;
  };

  const validateSchema = async () => {
    try {
      const response = await apiClient.inapp.templates.validate(parseSchema());
      setValidation({
        valid: response.valid,
        errors: response.errors,
        warnings: response.warnings
      });
      setError(null);
    } catch (validationError) {
      setError(validationError instanceof Error ? validationError.message : "Template validation failed");
    }
  };

  const create = async () => {
    try {
      await apiClient.inapp.templates.create({
        key: key.trim(),
        name: name.trim(),
        schemaJson: parseSchema()
      });
      setShowCreate(false);
      setValidation(null);
      setMessage("Template created.");
      await load();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Failed to create template");
    }
  };

  return (
    <section className="space-y-4">
      <PageHeader
        density="compact"
        title="Template Inventory"
        description="Define template schemas and validate required fields before campaign activation."
      />

      <FilterPanel density="compact" className="!space-y-0 flex items-center gap-2">
        <Button size="sm" onClick={() => setShowCreate((prev) => !prev)}>
          {showCreate ? "Close" : "Create Template"}
        </Button>
        <Button size="sm" variant="outline" onClick={() => void load()}>
          Refresh
        </Button>
      </FilterPanel>

      {showCreate ? (
        <PagePanel density="compact" className="grid gap-3">
          <div className="grid gap-3 md:grid-cols-2">
            <FieldLabel>
              Key
              <input value={key} onChange={(event) => setKey(event.target.value)} className={inputClassName} />
            </FieldLabel>
            <FieldLabel>
              Name
              <input value={name} onChange={(event) => setName(event.target.value)} className={inputClassName} />
            </FieldLabel>
          </div>

          <FieldLabel className="block">
            Schema JSON
            <textarea
              value={schemaText}
              onChange={(event) => setSchemaText(event.target.value)}
              className={`${inputClassName} min-h-64 font-mono text-xs`}
            />
          </FieldLabel>

          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => void validateSchema()}>
              Validate
            </Button>
            <Button size="sm" onClick={() => void create()}>
              Save
            </Button>
          </div>

          {validation ? (
            <div className="rounded-md border border-stone-200 bg-stone-50 p-3 text-sm">
              <p>
                <strong>Valid:</strong> {validation.valid ? "yes" : "no"}
              </p>
              <p>
                <strong>Errors:</strong> {validation.errors.length ? validation.errors.join(" | ") : "none"}
              </p>
              <p>
                <strong>Warnings:</strong> {validation.warnings.length ? validation.warnings.join(" | ") : "none"}
              </p>
            </div>
          ) : null}
        </PagePanel>
      ) : null}

      {error ? <InlineError title="Templates unavailable" description={error} /> : null}
      {message ? <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{message}</div> : null}
      {loading ? <p className="text-sm text-stone-600">Loading...</p> : null}

      <OperationalTableShell>
        <table className={operationalTableClassName}>
          <thead className={operationalTableHeadClassName}>
            <tr className="text-left text-stone-600">
              <th className={operationalTableHeaderCellClassName}>Key</th>
              <th className={operationalTableHeaderCellClassName}>Name</th>
              <th className={operationalTableHeaderCellClassName}>Schema</th>
              <th className={operationalTableHeaderCellClassName}>Updated</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td className={`${operationalTableCellClassName} font-medium`}>{item.key}</td>
                <td className={operationalTableCellClassName}>{item.name}</td>
                <td className={operationalTableCellClassName}>
                  <details>
                    <summary className="cursor-pointer text-xs text-indigo-700">View schema JSON</summary>
                    <pre className="mt-2 max-h-56 overflow-auto rounded border border-stone-200 bg-stone-50 p-2 text-xs">
                      {JSON.stringify(item.schemaJson, null, 2)}
                    </pre>
                  </details>
                </td>
                <td className={operationalTableCellClassName}>{new Date(item.updatedAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {items.length === 0 ? <EmptyState title="No templates found" className="p-4" /> : null}
      </OperationalTableShell>
    </section>
  );
}

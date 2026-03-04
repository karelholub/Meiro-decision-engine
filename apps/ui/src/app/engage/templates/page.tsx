"use client";

import { useEffect, useState } from "react";
import type { InAppTemplate } from "@decisioning/shared";
import { apiClient } from "../../../lib/api";
import { getEnvironment, onEnvironmentChange, type UiEnvironment } from "../../../lib/environment";

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
      <header className="rounded-lg border border-stone-200 bg-white p-4">
        <h2 className="text-xl font-semibold">Template Inventory</h2>
        <p className="text-sm text-stone-700">Define template schemas and validate required fields before campaign activation.</p>
      </header>

      <div className="rounded-lg border border-stone-200 bg-white p-3">
        <div className="flex items-center gap-2">
        <button className="rounded-md bg-ink px-3 py-2 text-sm text-white" onClick={() => setShowCreate((prev) => !prev)}>
          {showCreate ? "Close" : "Create Template"}
        </button>
        <button className="rounded-md border border-stone-300 px-3 py-2 text-sm" onClick={() => void load()}>
          Refresh
        </button>
        </div>
      </div>

      {showCreate ? (
        <article className="panel grid gap-3 p-4">
          <div className="grid gap-3 md:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
              Key
              <input value={key} onChange={(event) => setKey(event.target.value)} className="rounded-md border border-stone-300 px-2 py-1" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Name
              <input value={name} onChange={(event) => setName(event.target.value)} className="rounded-md border border-stone-300 px-2 py-1" />
            </label>
          </div>

          <label className="flex flex-col gap-1 text-sm">
            Schema JSON
            <textarea
              value={schemaText}
              onChange={(event) => setSchemaText(event.target.value)}
              className="min-h-64 rounded-md border border-stone-300 px-2 py-1 font-mono text-xs"
            />
          </label>

          <div className="flex items-center gap-2">
            <button className="rounded-md border border-stone-300 px-3 py-2 text-sm" onClick={() => void validateSchema()}>
              Validate
            </button>
            <button className="rounded-md bg-ink px-3 py-2 text-sm text-white" onClick={() => void create()}>
              Save
            </button>
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
        </article>
      ) : null}

      {error ? <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div> : null}
      {message ? <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{message}</div> : null}
      {loading ? <p className="text-sm text-stone-600">Loading...</p> : null}

      <div className="panel overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="text-left text-stone-600">
              <th className="border-b border-stone-200 px-3 py-2">Key</th>
              <th className="border-b border-stone-200 px-3 py-2">Name</th>
              <th className="border-b border-stone-200 px-3 py-2">Schema</th>
              <th className="border-b border-stone-200 px-3 py-2">Updated</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td className="border-b border-stone-100 px-3 py-2 font-medium">{item.key}</td>
                <td className="border-b border-stone-100 px-3 py-2">{item.name}</td>
                <td className="border-b border-stone-100 px-3 py-2">
                  <details>
                    <summary className="cursor-pointer text-xs text-indigo-700">View schema JSON</summary>
                    <pre className="mt-2 max-h-56 overflow-auto rounded border border-stone-200 bg-stone-50 p-2 text-xs">
                      {JSON.stringify(item.schemaJson, null, 2)}
                    </pre>
                  </details>
                </td>
                <td className="border-b border-stone-100 px-3 py-2">{new Date(item.updatedAt).toLocaleString()}</td>
              </tr>
            ))}
            {items.length === 0 ? (
              <tr>
                <td className="px-3 py-4 text-stone-600" colSpan={4}>
                  No templates found.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

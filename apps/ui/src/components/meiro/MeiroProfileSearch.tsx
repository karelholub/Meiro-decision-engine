"use client";

import { useState } from "react";
import { apiClient, type MeiroMcpCustomerSearchResult } from "../../lib/api";
import { Button } from "../ui/button";
import { inputClassName } from "../ui/page";

type ImportedMeiroProfile = {
  profileId: string;
  attributes: Record<string, unknown>;
  audiences: string[];
  consents?: string[];
};

type MeiroProfileSearchProps = {
  onImportProfile: (profile: ImportedMeiroProfile) => void;
};

export function MeiroProfileSearch({ onImportProfile }: MeiroProfileSearchProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MeiroMcpCustomerSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [importingId, setImportingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const search = async () => {
    if (!query.trim()) {
      setError("Enter a customer id, email, or search text.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await apiClient.meiro.mcp.searchCustomers(query.trim(), 8);
      setResults(response.items);
    } catch (searchError) {
      setResults([]);
      setError(searchError instanceof Error ? searchError.message : "Meiro customer search failed");
    } finally {
      setLoading(false);
    }
  };

  const importProfile = async (customer: MeiroMcpCustomerSearchResult) => {
    setImportingId(customer.id);
    setError(null);
    try {
      const response = await apiClient.meiro.mcp.customerAttributes(customer.id);
      onImportProfile({
        profileId: response.item.customerEntityId,
        attributes: response.item.attributes,
        audiences: [],
        consents: []
      });
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : "Failed to load Meiro customer attributes");
    } finally {
      setImportingId(null);
    }
  };

  return (
    <div className="space-y-2 rounded-md border border-stone-200 bg-stone-50 p-2">
      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-64 flex-1 text-sm">
          Meiro profile lookup
          <input
            className={inputClassName}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void search();
              }
            }}
            placeholder="customer id, email, or search text"
          />
        </label>
        <Button type="button" size="sm" variant="outline" onClick={() => void search()} disabled={loading}>
          {loading ? "Searching..." : "Search Meiro"}
        </Button>
      </div>
      <p className="text-xs text-stone-600">
        Imports customer attributes into an inline simulator profile. Audience memberships are not inferred unless Meiro returns them as attributes.
      </p>
      {error ? <p className="text-xs text-amber-700">{error}</p> : null}
      {results.length > 0 ? (
        <div className="max-h-48 overflow-auto rounded-md border border-stone-200 bg-white">
          {results.map((customer) => (
            <div key={customer.id} className="flex items-center justify-between gap-2 border-b border-stone-100 px-2 py-2 last:border-b-0">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{customer.displayName}</p>
                <p className="truncate font-mono text-xs text-stone-600">{customer.id}</p>
              </div>
              <Button type="button" size="xs" variant="outline" onClick={() => void importProfile(customer)} disabled={importingId === customer.id}>
                {importingId === customer.id ? "Loading..." : "Use"}
              </Button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

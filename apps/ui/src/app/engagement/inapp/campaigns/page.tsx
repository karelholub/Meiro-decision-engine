"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { InAppCampaign } from "@decisioning/shared";
import { apiClient } from "../../../../lib/api";
import { getEnvironment, onEnvironmentChange, type UiEnvironment } from "../../../../lib/environment";

export default function InAppCampaignsPage() {
  const [environment, setEnvironment] = useState<UiEnvironment>("DEV");
  const [items, setItems] = useState<InAppCampaign[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [filterAppKey, setFilterAppKey] = useState("");
  const [filterPlacementKey, setFilterPlacementKey] = useState("");
  const [filterStatus, setFilterStatus] = useState<"" | "DRAFT" | "ACTIVE" | "ARCHIVED">("");

  const [showCreate, setShowCreate] = useState(false);
  const [createKey, setCreateKey] = useState("demo_home_top");
  const [createName, setCreateName] = useState("Demo Home Top");
  const [createAppKey, setCreateAppKey] = useState("meiro_store");
  const [createPlacementKey, setCreatePlacementKey] = useState("home_top");
  const [createTemplateKey, setCreateTemplateKey] = useState("banner_v1");

  useEffect(() => {
    setEnvironment(getEnvironment());
    return onEnvironmentChange(setEnvironment);
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      const response = await apiClient.inapp.campaigns.list({
        appKey: filterAppKey || undefined,
        placementKey: filterPlacementKey || undefined,
        status: filterStatus || undefined
      });
      setItems(response.items);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load campaigns");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [environment]);

  const create = async () => {
    try {
      await apiClient.inapp.campaigns.create({
        key: createKey.trim(),
        name: createName.trim(),
        appKey: createAppKey.trim(),
        placementKey: createPlacementKey.trim(),
        templateKey: createTemplateKey.trim(),
        status: "DRAFT",
        priority: 10,
        ttlSeconds: 3600,
        holdoutEnabled: false,
        holdoutPercentage: 0,
        holdoutSalt: `${createKey.trim()}-holdout`,
        variants: [
          {
            variantKey: "A",
            weight: 100,
            contentJson: {
              title: "Hey {{first_name}} - quick pick for you",
              subtitle: "RFM {{rfm}}",
              cta: "Explore",
              image: "https://cdn.example.com/banner.jpg",
              deeplink: "app://home"
            }
          }
        ],
        tokenBindingsJson: {
          first_name: "mx_first_name_last|takeFirst",
          rfm: "web_rfm|takeFirst"
        }
      });
      setShowCreate(false);
      await load();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Failed to create campaign");
    }
  };

  return (
    <section className="space-y-4">
      <header className="panel p-4">
        <h2 className="text-xl font-semibold">Engagement / In-App / Campaigns</h2>
        <p className="text-sm text-stone-700">Create and manage campaigns and variants for runtime delivery.</p>
      </header>

      <div className="panel grid gap-3 p-4 md:grid-cols-4">
        <label className="flex flex-col gap-1 text-sm">
          App Key
          <input
            value={filterAppKey}
            onChange={(event) => setFilterAppKey(event.target.value)}
            className="rounded-md border border-stone-300 px-2 py-1"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Placement
          <input
            value={filterPlacementKey}
            onChange={(event) => setFilterPlacementKey(event.target.value)}
            className="rounded-md border border-stone-300 px-2 py-1"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Status
          <select
            value={filterStatus}
            onChange={(event) => setFilterStatus(event.target.value as "" | "DRAFT" | "ACTIVE" | "ARCHIVED")}
            className="rounded-md border border-stone-300 px-2 py-1"
          >
            <option value="">All</option>
            <option value="DRAFT">DRAFT</option>
            <option value="ACTIVE">ACTIVE</option>
            <option value="ARCHIVED">ARCHIVED</option>
          </select>
        </label>
        <div className="flex items-end gap-2">
          <button className="rounded-md border border-stone-300 px-3 py-2 text-sm" onClick={() => void load()}>
            Apply
          </button>
          <button className="rounded-md bg-ink px-3 py-2 text-sm text-white" onClick={() => setShowCreate((prev) => !prev)}>
            {showCreate ? "Close" : "Create"}
          </button>
        </div>
      </div>

      {showCreate ? (
        <article className="panel grid gap-3 p-4 md:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            Campaign Key
            <input
              value={createKey}
              onChange={(event) => setCreateKey(event.target.value)}
              className="rounded-md border border-stone-300 px-2 py-1"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Name
            <input
              value={createName}
              onChange={(event) => setCreateName(event.target.value)}
              className="rounded-md border border-stone-300 px-2 py-1"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            App Key
            <input
              value={createAppKey}
              onChange={(event) => setCreateAppKey(event.target.value)}
              className="rounded-md border border-stone-300 px-2 py-1"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Placement Key
            <input
              value={createPlacementKey}
              onChange={(event) => setCreatePlacementKey(event.target.value)}
              className="rounded-md border border-stone-300 px-2 py-1"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm md:col-span-2">
            Template Key
            <input
              value={createTemplateKey}
              onChange={(event) => setCreateTemplateKey(event.target.value)}
              className="rounded-md border border-stone-300 px-2 py-1"
            />
          </label>
          <div className="md:col-span-2">
            <button className="rounded-md bg-ink px-3 py-2 text-sm text-white" onClick={() => void create()}>
              Save Draft
            </button>
          </div>
        </article>
      ) : null}

      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      {loading ? <p className="text-sm">Loading...</p> : null}

      <div className="space-y-3">
        {items.map((item) => (
          <article key={item.id} className="panel p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold">{item.name}</h3>
                <p className="text-sm text-stone-700">
                  {item.key} · {item.status} · app {item.appKey} · placement {item.placementKey}
                </p>
                <p className="text-xs text-stone-600">
                  priority {item.priority} · ttl {item.ttlSeconds}s · variants {item.variants.length}
                </p>
              </div>
              <div className="flex gap-2 text-sm">
                <Link href={`/engagement/inapp/campaigns/${item.id}`} className="rounded-md border border-stone-300 px-3 py-1">
                  Edit
                </Link>
              </div>
            </div>
          </article>
        ))}
        {items.length === 0 ? <p className="text-sm text-stone-600">No campaigns found.</p> : null}
      </div>
    </section>
  );
}

"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { CatalogContentBlock, CatalogOffer, InAppApplication, InAppCampaign, InAppPlacement, InAppTemplate } from "@decisioning/shared";
import { apiClient } from "../../../../lib/api";
import { getEnvironment, onEnvironmentChange, type UiEnvironment } from "../../../../lib/environment";

export default function InAppCampaignsPage() {
  const [environment, setEnvironment] = useState<UiEnvironment>("DEV");
  const [items, setItems] = useState<InAppCampaign[]>([]);
  const [apps, setApps] = useState<InAppApplication[]>([]);
  const [placements, setPlacements] = useState<InAppPlacement[]>([]);
  const [templates, setTemplates] = useState<InAppTemplate[]>([]);
  const [contentBlocks, setContentBlocks] = useState<CatalogContentBlock[]>([]);
  const [offers, setOffers] = useState<CatalogOffer[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [filterAppKey, setFilterAppKey] = useState("");
  const [filterPlacementKey, setFilterPlacementKey] = useState("");
  const [filterStatus, setFilterStatus] = useState<"" | "DRAFT" | "PENDING_APPROVAL" | "ACTIVE" | "ARCHIVED">("");

  const [showCreate, setShowCreate] = useState(false);
  const [createKey, setCreateKey] = useState("demo_home_top");
  const [createName, setCreateName] = useState("Demo Home Top");
  const [createAppKey, setCreateAppKey] = useState("meiro_store");
  const [createPlacementKey, setCreatePlacementKey] = useState("home_top");
  const [createTemplateKey, setCreateTemplateKey] = useState("banner_v1");
  const [createContentKey, setCreateContentKey] = useState("HOME_TOP_BANNER_WINBACK");
  const [createOfferKey, setCreateOfferKey] = useState("WINBACK10");

  useEffect(() => {
    setEnvironment(getEnvironment());
    return onEnvironmentChange(setEnvironment);
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      const [campaignsResponse, appsResponse, placementsResponse, templatesResponse, contentResponse, offersResponse] = await Promise.all([
        apiClient.inapp.campaigns.list({
          appKey: filterAppKey || undefined,
          placementKey: filterPlacementKey || undefined,
          status: filterStatus || undefined
        }),
        apiClient.inapp.apps.list(),
        apiClient.inapp.placements.list(),
        apiClient.inapp.templates.list(),
        apiClient.catalog.content.list(),
        apiClient.catalog.offers.list()
      ]);
      setItems(campaignsResponse.items);
      setApps(appsResponse.items);
      setPlacements(placementsResponse.items);
      setTemplates(templatesResponse.items);
      setContentBlocks(contentResponse.items);
      setOffers(offersResponse.items);
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

  useEffect(() => {
    if (filterAppKey && !apps.some((item) => item.key === filterAppKey)) {
      setFilterAppKey("");
    }
    if (!createAppKey && apps[0]) {
      setCreateAppKey(apps[0].key);
    }
    if (createAppKey && !apps.some((item) => item.key === createAppKey) && apps[0]) {
      setCreateAppKey(apps[0].key);
    }
  }, [apps, createAppKey, filterAppKey]);

  useEffect(() => {
    if (filterPlacementKey && !placements.some((item) => item.key === filterPlacementKey)) {
      setFilterPlacementKey("");
    }
    if (!createPlacementKey && placements[0]) {
      setCreatePlacementKey(placements[0].key);
    }
    if (createPlacementKey && !placements.some((item) => item.key === createPlacementKey) && placements[0]) {
      setCreatePlacementKey(placements[0].key);
    }
  }, [placements, createPlacementKey, filterPlacementKey]);

  useEffect(() => {
    if (!createTemplateKey && templates[0]) {
      setCreateTemplateKey(templates[0].key);
    }
    if (createTemplateKey && !templates.some((item) => item.key === createTemplateKey) && templates[0]) {
      setCreateTemplateKey(templates[0].key);
    }
  }, [templates, createTemplateKey]);

  const create = async () => {
    try {
      const selectedContent = createContentKey.trim()
        ? contentBlocks
            .filter((item) => item.key === createContentKey.trim())
            .sort((a, b) => b.version - a.version)[0]
        : null;
      const useCatalogContent = Boolean(selectedContent);

      await apiClient.inapp.campaigns.create({
        key: createKey.trim(),
        name: createName.trim(),
        appKey: createAppKey.trim(),
        placementKey: createPlacementKey.trim(),
        templateKey: useCatalogContent ? selectedContent?.templateId : createTemplateKey.trim(),
        contentKey: useCatalogContent ? createContentKey.trim() : undefined,
        offerKey: createOfferKey.trim() || undefined,
        status: "DRAFT",
        priority: 10,
        ttlSeconds: 3600,
        holdoutEnabled: false,
        holdoutPercentage: 0,
        holdoutSalt: `${createKey.trim()}-holdout`,
        variants: useCatalogContent
          ? []
          : [
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
          <select
            value={filterAppKey}
            onChange={(event) => setFilterAppKey(event.target.value)}
            className="rounded-md border border-stone-300 px-2 py-1"
          >
            <option value="">All apps</option>
            {apps.map((item) => (
              <option key={item.id} value={item.key}>
                {item.key}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Placement
          <select
            value={filterPlacementKey}
            onChange={(event) => setFilterPlacementKey(event.target.value)}
            className="rounded-md border border-stone-300 px-2 py-1"
          >
            <option value="">All placements</option>
            {placements.map((item) => (
              <option key={item.id} value={item.key}>
                {item.key}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Status
          <select
            value={filterStatus}
            onChange={(event) => setFilterStatus(event.target.value as "" | "DRAFT" | "PENDING_APPROVAL" | "ACTIVE" | "ARCHIVED")}
            className="rounded-md border border-stone-300 px-2 py-1"
          >
            <option value="">All</option>
            <option value="DRAFT">DRAFT</option>
            <option value="PENDING_APPROVAL">PENDING_APPROVAL</option>
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
            <select
              value={createAppKey}
              onChange={(event) => setCreateAppKey(event.target.value)}
              className="rounded-md border border-stone-300 px-2 py-1"
            >
              <option value="">Select app</option>
              {apps.map((item) => (
                <option key={item.id} value={item.key}>
                  {item.key}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Placement Key
            <select
              value={createPlacementKey}
              onChange={(event) => setCreatePlacementKey(event.target.value)}
              className="rounded-md border border-stone-300 px-2 py-1"
            >
              <option value="">Select placement</option>
              {placements.map((item) => (
                <option key={item.id} value={item.key}>
                  {item.key}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm md:col-span-2">
            Template Key
            <select
              value={createTemplateKey}
              onChange={(event) => setCreateTemplateKey(event.target.value)}
              className="rounded-md border border-stone-300 px-2 py-1"
            >
              <option value="">Select template</option>
              {templates.map((item) => (
                <option key={item.id} value={item.key}>
                  {item.key}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Content Key (optional)
            <select
              value={createContentKey}
              onChange={(event) => setCreateContentKey(event.target.value)}
              className="rounded-md border border-stone-300 px-2 py-1"
            >
              <option value="">None (raw variant payload)</option>
              {[...new Set(contentBlocks.map((item) => item.key))].map((key) => (
                <option key={key} value={key}>
                  {key}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Offer Key (optional)
            <select
              value={createOfferKey}
              onChange={(event) => setCreateOfferKey(event.target.value)}
              className="rounded-md border border-stone-300 px-2 py-1"
            >
              <option value="">None</option>
              {[...new Set(offers.map((item) => item.key))].map((key) => (
                <option key={key} value={key}>
                  {key}
                </option>
              ))}
            </select>
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
                  {item.contentKey ? ` · content ${item.contentKey}` : ""}
                  {item.offerKey ? ` · offer ${item.offerKey}` : ""}
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

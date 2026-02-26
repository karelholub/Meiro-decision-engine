"use client";

import { useState, type KeyboardEvent } from "react";
import type { CatalogOffer } from "@decisioning/shared";
import { Button } from "../ui/button";

export type OfferEditorModel = {
  key: string;
  name: string;
  description: string;
  status: CatalogOffer["status"];
  type: CatalogOffer["type"];
  tags: string[];
  startAt: string;
  endAt: string;
  valueJsonText: string;
  constraintsJsonText: string;
};

export type DiscountFieldErrors = Partial<Record<"code" | "percent" | "minSpend", string>>;

type GenericValuePair = {
  key: string;
  value: string;
};

type OfferEditorProps = {
  value: OfferEditorModel;
  onChange: (patch: Partial<OfferEditorModel>) => void;
  readOnlyKey: boolean;
  readOnly?: boolean;
  availableTags: string[];
  discountFields: {
    code: string;
    percent: string;
    minSpend: string;
    newCustomersOnly: boolean;
  };
  discountErrors: DiscountFieldErrors;
  genericPairs: GenericValuePair[];
  advancedOnly: boolean;
  advancedReasons: string[];
  onDiscountFieldChange: (patch: Partial<OfferEditorProps["discountFields"]>) => void;
  onGenericPairsChange: (pairs: GenericValuePair[]) => void;
  showAdvanced: boolean;
  onToggleAdvanced: () => void;
};

export function OfferEditor({
  value,
  onChange,
  readOnlyKey,
  readOnly,
  availableTags,
  discountFields,
  discountErrors,
  genericPairs,
  advancedOnly,
  advancedReasons,
  onDiscountFieldChange,
  onGenericPairsChange,
  showAdvanced,
  onToggleAdvanced
}: OfferEditorProps) {
  const [pendingTag, setPendingTag] = useState("");

  const addTag = (input: string) => {
    const tag = input.trim();
    if (!tag || value.tags.includes(tag)) {
      return;
    }
    onChange({ tags: [...value.tags, tag] });
  };

  const onTagKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter" && event.key !== ",") {
      return;
    }
    event.preventDefault();
    addTag(pendingTag);
    setPendingTag("");
  };

  return (
    <article className="panel grid gap-3 p-4 md:grid-cols-2">
      <label className="flex flex-col gap-1 text-sm">
        Key
        <input
          value={value.key}
              onChange={(event) => onChange({ key: event.target.value })}
              className="rounded-md border border-stone-300 px-2 py-1"
              disabled={readOnlyKey || readOnly}
            />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Name
        <input
          value={value.name}
          onChange={(event) => onChange({ name: event.target.value })}
          className="rounded-md border border-stone-300 px-2 py-1"
          disabled={readOnly}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm md:col-span-2">
        Description
        <input
          value={value.description}
          onChange={(event) => onChange({ description: event.target.value })}
          className="rounded-md border border-stone-300 px-2 py-1"
          disabled={readOnly}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Status
        <select
          value={value.status}
          onChange={(event) => onChange({ status: event.target.value as CatalogOffer["status"] })}
          className="rounded-md border border-stone-300 px-2 py-1"
          disabled={readOnly}
        >
          <option value="DRAFT">DRAFT</option>
          <option value="ACTIVE">ACTIVE</option>
          <option value="ARCHIVED">ARCHIVED</option>
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Type
        <select
          value={value.type}
          onChange={(event) => onChange({ type: event.target.value as CatalogOffer["type"] })}
          className="rounded-md border border-stone-300 px-2 py-1"
          disabled={readOnly}
        >
          <option value="discount">discount</option>
          <option value="free_shipping">free_shipping</option>
          <option value="bonus">bonus</option>
          <option value="content_only">content_only</option>
        </select>
      </label>

      <div className="md:col-span-2 space-y-2">
        <label className="text-sm">Tags</label>
        <div className="flex flex-wrap gap-2 rounded-md border border-stone-300 px-2 py-2">
          {value.tags.map((tag) => (
            <span key={tag} className="inline-flex items-center gap-1 rounded-full border border-stone-300 bg-stone-100 px-2 py-0.5 text-xs">
              {tag}
              <button
                type="button"
                className="text-stone-500 hover:text-red-700"
                onClick={() => onChange({ tags: value.tags.filter((entry) => entry !== tag) })}
                aria-label={`Remove tag ${tag}`}
                disabled={readOnly}
              >
                x
              </button>
            </span>
          ))}
          <input
            list="catalog-tags"
            value={pendingTag}
            placeholder="Add tag"
            onChange={(event) => setPendingTag(event.target.value)}
            onKeyDown={onTagKeyDown}
            onBlur={() => {
              if (!pendingTag.trim()) {
                return;
              }
              addTag(pendingTag);
              setPendingTag("");
            }}
            className="min-w-36 flex-1 border-none p-0 text-sm outline-none"
            disabled={readOnly}
          />
          <datalist id="catalog-tags">
            {availableTags.map((tag) => (
              <option value={tag} key={tag} />
            ))}
          </datalist>
        </div>
      </div>

      <label className="flex flex-col gap-1 text-sm">
        Start At
        <input
          type="datetime-local"
          value={value.startAt}
          onChange={(event) => onChange({ startAt: event.target.value })}
          className="rounded-md border border-stone-300 px-2 py-1"
          disabled={readOnly}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        End At
        <input
          type="datetime-local"
          value={value.endAt}
          onChange={(event) => onChange({ endAt: event.target.value })}
          className="rounded-md border border-stone-300 px-2 py-1"
          disabled={readOnly}
        />
      </label>

      <section className="md:col-span-2 rounded-md border border-stone-200 bg-stone-50 p-3">
        <h3 className="font-medium">Structured Offer</h3>
        {advancedOnly ? (
          <p className="mt-1 text-xs text-amber-700">Advanced-only mode. {advancedReasons.join(" | ")}</p>
        ) : null}

        {value.type === "discount" ? (
          <div className="mt-2 grid gap-3 md:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
              Code
              <input
                value={discountFields.code}
                onChange={(event) => onDiscountFieldChange({ code: event.target.value })}
                className="rounded-md border border-stone-300 px-2 py-1"
                disabled={advancedOnly}
                readOnly={readOnly}
              />
              {discountErrors.code ? <span className="text-xs text-red-700">{discountErrors.code}</span> : null}
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Percent
              <input
                value={discountFields.percent}
                onChange={(event) => onDiscountFieldChange({ percent: event.target.value })}
                className="rounded-md border border-stone-300 px-2 py-1"
                disabled={advancedOnly}
                readOnly={readOnly}
              />
              {discountErrors.percent ? <span className="text-xs text-red-700">{discountErrors.percent}</span> : null}
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Min Spend (optional)
              <input
                value={discountFields.minSpend}
                onChange={(event) => onDiscountFieldChange({ minSpend: event.target.value })}
                className="rounded-md border border-stone-300 px-2 py-1"
                disabled={advancedOnly}
                readOnly={readOnly}
              />
              {discountErrors.minSpend ? <span className="text-xs text-red-700">{discountErrors.minSpend}</span> : null}
            </label>
            <label className="mt-6 inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={discountFields.newCustomersOnly}
                onChange={(event) => onDiscountFieldChange({ newCustomersOnly: event.target.checked })}
                disabled={advancedOnly}
                readOnly={readOnly}
              />
              New customers only
            </label>
          </div>
        ) : (
          <div className="mt-2 space-y-2">
            {genericPairs.map((pair, index) => (
              <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]" key={`${index}-${pair.key}`}>
                <input
                  value={pair.key}
                  onChange={(event) => {
                    const next = [...genericPairs];
                    const currentRow = next[index] ?? { key: "", value: "" };
                    next[index] = { ...currentRow, key: event.target.value };
                    onGenericPairsChange(next);
                  }}
                  className="rounded-md border border-stone-300 px-2 py-1 text-sm"
                  placeholder="Field key"
                  disabled={advancedOnly}
                  readOnly={readOnly}
                />
                <input
                  value={pair.value}
                  onChange={(event) => {
                    const next = [...genericPairs];
                    const currentRow = next[index] ?? { key: "", value: "" };
                    next[index] = { ...currentRow, value: event.target.value };
                    onGenericPairsChange(next);
                  }}
                  className="rounded-md border border-stone-300 px-2 py-1 text-sm"
                  placeholder="Field value"
                  disabled={advancedOnly}
                  readOnly={readOnly}
                />
                <Button
                  variant="ghost"
                  type="button"
                  onClick={() => onGenericPairsChange(genericPairs.filter((_, pairIndex) => pairIndex !== index))}
                  disabled={advancedOnly || readOnly}
                >
                  Remove
                </Button>
              </div>
            ))}
            <Button
              variant="outline"
              type="button"
              onClick={() => onGenericPairsChange([...genericPairs, { key: "", value: "" }])}
              disabled={advancedOnly || readOnly}
            >
              Add field
            </Button>
          </div>
        )}
      </section>

      <section className="md:col-span-2">
        <button type="button" className="text-sm font-medium underline" onClick={onToggleAdvanced} disabled={readOnly}>
          {showAdvanced ? "Hide Advanced JSON" : "Advanced JSON"}
        </button>

        {showAdvanced ? (
          <div className="mt-2 grid gap-3 md:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
              valueJson
              <textarea
                value={value.valueJsonText}
                onChange={(event) => onChange({ valueJsonText: event.target.value })}
                className="min-h-40 rounded-md border border-stone-300 px-2 py-1 font-mono text-xs"
                disabled={readOnly}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              constraints
              <textarea
                value={value.constraintsJsonText}
                onChange={(event) => onChange({ constraintsJsonText: event.target.value })}
                className="min-h-40 rounded-md border border-stone-300 px-2 py-1 font-mono text-xs"
                disabled={readOnly}
              />
            </label>
          </div>
        ) : null}
      </section>
    </article>
  );
}

"use client";

import React from "react";
import Link from "next/link";
import type { ActivationLibraryItem } from "../../lib/api";
import { assetCalendarUsageHref, assetCampaignPlanHref, assetEditorHref } from "./activationAssetConfig";

type AssetActionsProps = {
  item: ActivationLibraryItem;
  onSelect?: (item: ActivationLibraryItem) => void;
  selectLabel?: string;
  disabled?: boolean;
  compact?: boolean;
  showOpen?: boolean;
  showPlan?: boolean;
  showCalendar?: boolean;
  className?: string;
};

const linkClass = (compact: boolean) =>
  `rounded-md border border-stone-300 bg-white font-medium text-stone-700 hover:border-stone-500 ${compact ? "px-2 py-1 text-xs" : "px-3 py-2 text-sm"}`;

export function AssetActions({
  item,
  onSelect,
  selectLabel = "Use this asset",
  disabled,
  compact = false,
  showOpen = true,
  showPlan = true,
  showCalendar = true,
  className = ""
}: AssetActionsProps) {
  const planHref = assetCampaignPlanHref(item);
  const sizeClass = compact ? "px-2 py-1 text-xs" : "px-3 py-2 text-sm";
  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      {onSelect ? (
        <button
          type="button"
          className={`rounded-md border border-stone-900 bg-stone-900 font-medium text-white disabled:cursor-not-allowed disabled:opacity-50 ${sizeClass}`}
          disabled={disabled}
          onClick={() => onSelect(item)}
        >
          {selectLabel}
        </button>
      ) : null}
      {showOpen ? (
        <Link className={linkClass(compact)} href={assetEditorHref(item)}>
          Open editor
        </Link>
      ) : null}
      {showPlan && planHref ? (
        <Link className={linkClass(compact)} href={planHref}>
          Plan campaign
        </Link>
      ) : null}
      {showCalendar ? (
        <Link className={linkClass(compact)} href={assetCalendarUsageHref(item)}>
          View calendar
        </Link>
      ) : null}
    </div>
  );
}

import type { FieldRegistryItem } from "./types";

export const fieldRegistry: FieldRegistryItem[] = [
  {
    field: "purchase_count",
    label: "Purchase Count",
    dataType: "number",
    common: true,
    sampleValues: [0, 1, 5, 10]
  },
  {
    field: "email",
    label: "Email",
    dataType: "string",
    common: true,
    sampleValues: ["alex@example.com"]
  },
  {
    field: "consent_marketing",
    label: "Marketing Consent",
    dataType: "boolean",
    common: true,
    sampleValues: [true, false]
  },
  {
    field: "country",
    label: "Country",
    dataType: "string",
    common: true,
    sampleValues: ["US", "JP", "DE"]
  },
  {
    field: "cart_value",
    label: "Cart Value",
    dataType: "number",
    common: true,
    sampleValues: [0, 25, 99.5]
  },
  {
    field: "segments",
    label: "Segments",
    dataType: "array",
    sampleValues: ["vip", "new_user"]
  },
  {
    field: "locale",
    label: "Locale",
    dataType: "string",
    sampleValues: ["en-US", "ja-JP"]
  },
  {
    field: "last_seen_days",
    label: "Last Seen (Days)",
    dataType: "number",
    sampleValues: [0, 2, 30]
  }
];

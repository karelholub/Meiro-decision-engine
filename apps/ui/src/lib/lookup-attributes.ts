export const COMMON_LOOKUP_ATTRIBUTES = ["email", "customer_id", "external_id", "phone", "device_id"] as const;

export const CUSTOM_LOOKUP_ATTRIBUTE = "__custom_lookup_attribute__";

export const isCommonLookupAttribute = (value: string): boolean => {
  return COMMON_LOOKUP_ATTRIBUTES.includes(value as (typeof COMMON_LOOKUP_ATTRIBUTES)[number]);
};

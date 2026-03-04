import { describe, expect, it, vi } from "vitest";
import {
  INVENTORY_PREFS_KEY,
  defaultColumns,
  defaultPrefs,
  formatVariantsSummary,
  loadInventoryPrefs,
  saveInventoryPrefs
} from "./inventory-utils";

describe("formatVariantsSummary", () => {
  it("returns fallback for empty", () => {
    expect(formatVariantsSummary({ variantsSummary: "" })).toBe("-");
  });

  it("keeps explicit summary", () => {
    expect(formatVariantsSummary({ variantsSummary: "A 50% / B 50%" })).toBe("A 50% / B 50%");
  });
});

describe("inventory prefs localStorage", () => {
  it("persists and reloads state", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => {
          store.set(key, value);
        }
      }
    });

    const prefs = {
      ...defaultPrefs(),
      sort: "name_asc" as const,
      columns: { ...defaultColumns(), health: false }
    };
    saveInventoryPrefs(prefs);

    expect(store.has(INVENTORY_PREFS_KEY)).toBe(true);
    const loaded = loadInventoryPrefs();
    expect(loaded.sort).toBe("name_asc");
    expect(loaded.columns.health).toBe(false);

    vi.unstubAllGlobals();
  });
});

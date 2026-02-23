// Minimal local-only smoke setup. Run with: pnpm --filter @decisioning/ui test:e2e
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.playwright.js",
  use: {
    baseURL: process.env.E2E_UI_BASE_URL || "http://localhost:3000"
  }
});

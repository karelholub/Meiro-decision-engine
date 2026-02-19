// Minimal local-only smoke setup. Run with: pnpm --filter @decisioning/ui test:e2e
const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./e2e",
  use: {
    baseURL: process.env.E2E_UI_BASE_URL || "http://localhost:3000"
  }
});

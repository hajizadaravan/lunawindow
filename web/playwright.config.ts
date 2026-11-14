import { defineConfig, devices } from "@playwright/test";

const dataDir = process.env.VITE_DATA_DIR ?? "data";
const port = 4179;

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  use: { baseURL: `http://localhost:${port}`, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } }],
  webServer: {
    command: `VITE_DATA_DIR=${dataDir} npx vite --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});

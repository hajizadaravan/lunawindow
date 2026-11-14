import { defineConfig, devices } from "@playwright/test";

const dataDir = process.env.VITE_DATA_DIR ?? "data";
// E2E_PORT lets two lanes run suites at the same time without colliding.
const port = Number(process.env.E2E_PORT ?? 4179);

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

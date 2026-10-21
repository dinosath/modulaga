import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/spike",
  fullyParallel: false,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4173",
    browserName: "chromium",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "./node_modules/.bin/vite preview --host 127.0.0.1 --port 4173 --strictPort",
      cwd: "apps/shell",
      url: "http://127.0.0.1:4173",
      reuseExistingServer: !process.env.CI,
    },
    {
      command: "./node_modules/.bin/vite preview --host 127.0.0.1 --port 4174 --strictPort",
      cwd: "apps/demo-react",
      url: "http://127.0.0.1:4174/mf-manifest.json",
      reuseExistingServer: !process.env.CI,
    },
  ],
});

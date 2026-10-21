import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config.ts";

export default mergeConfig(
  viteConfig,
  defineConfig({
    resolve: { conditions: ["browser", "development"] },
    ssr: { resolve: { conditions: ["browser", "development"] }, noExternal: ["solid-js", "@solidjs/web"] },
    test: {
      environment: "happy-dom",
      server: { deps: { inline: ["solid-js", "@solidjs/web"] } },
      include: ["src/**/*.test.{ts,tsx}"],
      coverage: {
        provider: "v8",
        include: ["src/config/navigation.ts", "src/workspace/api.ts"],
        exclude: ["src/**/*.test.ts", "src/**/*.test.tsx"],
        thresholds: { lines: 90, functions: 90, branches: 90, statements: 90 },
      },
    },
  }),
);

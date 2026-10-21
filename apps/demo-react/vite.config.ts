import { federation } from "@module-federation/vite";
import { defineConfig } from "vite";

export default defineConfig({
  base: "http://127.0.0.1:4174/",
  plugins: [
    federation({
      name: "demo_react",
      filename: "remoteEntry.js",
      manifest: true,
      exposes: {
        "./mount": "./src/mount.tsx",
      },
    }),
  ],
  preview: {
    host: "127.0.0.1",
    port: 4174,
    strictPort: true,
  },
  server: {
    host: "127.0.0.1",
    port: 5174,
    strictPort: true,
  },
});
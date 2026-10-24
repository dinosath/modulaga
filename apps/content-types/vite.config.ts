import { federation } from "@module-federation/vite";
import solid from "@solidjs/vite-plugin";
import UnoCSS from "unocss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  base: process.env.CONTENT_TYPES_PUBLIC_URL ?? "http://localhost:4175/",
  plugins: [
    solid(),
    UnoCSS(),
    federation({
      name: "content_types",
      filename: "remoteEntry.js",
      manifest: true,
      dts: false,
      exposes: { "./mount": "./src/mount.tsx" },
    }),
  ],
  preview: { host: "127.0.0.1", port: 4175, strictPort: true },
  server: { host: "127.0.0.1", port: 5175, strictPort: true },
});

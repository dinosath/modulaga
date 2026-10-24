import solid from "@solidjs/vite-plugin";
import UnoCSS from "unocss/vite";
import { federation } from "@module-federation/vite";
import { defineConfig } from "vite";

export default defineConfig({
  base: process.env.ADMIN_PANEL_PUBLIC_URL ?? "http://localhost:4176/",
  plugins: [solid(), UnoCSS(), federation({
    name: "admin_panel",
    filename: "remoteEntry.js",
    manifest: true,
    dts: false,
    exposes: { "./mount": "./src/mount.tsx" },
  })],
  preview: { host: "127.0.0.1", port: 4176, strictPort: true },
  server: { host: "127.0.0.1", port: 5176, strictPort: true },
});

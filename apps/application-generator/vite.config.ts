import { federation } from "@module-federation/vite";
import solid from "@solidjs/vite-plugin";
import UnoCSS from "unocss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  base: process.env.APPLICATION_GENERATOR_PUBLIC_URL ?? "http://localhost:4177/",
  plugins: [solid(), UnoCSS(), federation({
    name: "application_generator",
    filename: "remoteEntry.js",
    manifest: true,
    dts: false,
    exposes: { "./mount": "./src/mount.tsx" },
  })],
  preview: { host: "127.0.0.1", port: 4177, strictPort: true },
  server: { host: "127.0.0.1", port: 5178, strictPort: true },
});

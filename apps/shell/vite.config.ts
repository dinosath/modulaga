import { defineConfig } from "vite";
import solid from "@solidjs/vite-plugin";
import UnoCSS from "unocss/vite";

export default defineConfig({
  plugins: [solid(), UnoCSS()],
  server: {
    host: "127.0.0.1",
    port: 4300,
    strictPort: true,
  },
});

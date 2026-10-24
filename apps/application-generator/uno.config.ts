import { defineConfig, presetWind4 } from "unocss";

export default defineConfig({
  presets: [presetWind4()],
  content: { pipeline: { include: [/apps\/application-generator\/.*\.[jt]sx?$/, /apps\/shell\/src\/components\/ui\/.*\.[jt]sx?$/] } },
  theme: { colors: {
    background: "#ffffff", foreground: "#09090b", card: "#ffffff", muted: "#f4f4f5", "muted-foreground": "#71717a",
    primary: "#18181b", "primary-foreground": "#fafafa", secondary: "#f4f4f5", "secondary-foreground": "#18181b",
    accent: "#f4f4f5", "accent-foreground": "#18181b", destructive: "#ef4444", border: "#e4e4e7", input: "#e4e4e7", ring: "#a1a1aa",
  } },
});

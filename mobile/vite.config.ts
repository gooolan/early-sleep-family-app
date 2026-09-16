import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  build: { rollupOptions: { input: mode === "icon-preview" ? ["index.html", "icon-preview.html"] : "index.html" } },
  server: { host: "0.0.0.0", port: 5173 },
}));

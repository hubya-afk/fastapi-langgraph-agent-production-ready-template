import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// During development (`npm run dev`) the frontend runs on port 3000 and proxies
// `/api` to the FastAPI backend. In production the FastAPI app serves the built
// `dist/` directly, so the frontend and API share the same origin.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8080",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
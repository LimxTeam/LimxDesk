import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  root: path.resolve(__dirname, "./apps"),
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@limxdesk/shell": path.resolve(__dirname, "./packages/shell/src/index.ts"),
      "@limxdesk/notifications": path.resolve(__dirname, "./packages/notifications/src/index.ts"),
      "@limxdesk/ui": path.resolve(__dirname, "./packages/ui/src/index.tsx"),
      "@limxdesk/console": path.resolve(__dirname, "./packages/console/src/index.ts"),
      "@limxdesk/settings": path.resolve(__dirname, "./packages/settings/src/index.ts"),
      "@": path.resolve(__dirname, "./apps/src"),
    },
  },
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 5174,
        }
      : undefined,
    watch: {
      ignored: ["**/backend/target/**"],
    },
  },
  build: {
    outDir: path.resolve(__dirname, "./dist"),
    emptyOutDir: true,
    target: "esnext",
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
  },
});

import { defineConfig } from "vite";
import vike from "vike/plugin";
import react from "@vitejs/plugin-react";
import path from "path";

// Extract workspace number from directory name (e.g., "platform-ws2" → 2)
// Used to auto-assign ports: ws1 gets 8001/3001, ws2 gets 8002/3002, etc.
// No workspace suffix → 8000/3000 (default)
const workspaceMatch = path.basename(path.resolve(__dirname, "..")).match(/-ws(\d+)$/);
const wsNum = workspaceMatch ? parseInt(workspaceMatch[1], 10) : 0;
const defaultApiPort = 8000 + wsNum;
const defaultFrontendPort = 3000 + wsNum;

export default defineConfig({
  plugins: [
    react(),
    vike({
      prerender: {
        partial: true,
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: parseInt(process.env.FRONTEND_PORT || String(defaultFrontendPort), 10),
    proxy: {
      "/api": {
        target: process.env.VITE_API_URL || `http://localhost:${defaultApiPort}`,
        changeOrigin: true,
      },
      "/auth": {
        target: process.env.VITE_API_URL || `http://localhost:${defaultApiPort}`,
        changeOrigin: true,
      },
    },
  },
  build: {
    target: "esnext",
  },
  ssr: {
    noExternal: ["react-use"],
  },
});

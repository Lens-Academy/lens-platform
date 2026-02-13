import { defineConfig, loadEnv } from "vite";
import vike from "vike/plugin";
import react from "@vitejs/plugin-react";
import path from "path";

// Extract workspace number from directory name (e.g., "platform-ws2" → 2)
// Used to auto-assign ports: ws1 gets 8100/3100, ws2 gets 8200/3200, etc.
// Offset by 100 so each workspace has a port range that won't collide if
// a server auto-increments to the next available port.
// No workspace suffix → 8000/3000 (default)
const workspaceMatch = path.basename(path.resolve(__dirname, "..")).match(/(?:^|-)ws(\d+)$/);
const wsNum = workspaceMatch ? parseInt(workspaceMatch[1], 10) : 0;
const defaultApiPort = 8000 + wsNum * 100;
const defaultFrontendPort = 3000 + wsNum * 100;

export default defineConfig(({ mode }) => {
  const wsEnv = loadEnv(mode, path.resolve(__dirname, ".."));
  let envLabel = wsEnv.VITE_ENV_LABEL || "";
  if (envLabel === "DEV" && wsNum > 0) {
    envLabel = `Dev${wsNum}`;
  }

  return {
    define: {
      ...(envLabel ? { "import.meta.env.VITE_ENV_LABEL": JSON.stringify(envLabel) } : {}),
    },
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
      host: true,
      allowedHosts: ["dev.vps"],
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
  };
});

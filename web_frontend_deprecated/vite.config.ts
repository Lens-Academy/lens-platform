/// <reference types="vitest" />
import { defineConfig } from "vite";
import type { Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import fs from "fs";
import path from "path";

// Plugin to serve static landing page at root (dev server only)
function serveLandingPage(): Plugin {
  return {
    name: "serve-landing-page",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url === "/" || req.url === "/index.html") {
          const landingPath = path.resolve(__dirname, "static/landing.html");
          if (fs.existsSync(landingPath)) {
            res.setHeader("Content-Type", "text/html");
            res.end(fs.readFileSync(landingPath, "utf-8"));
            return;
          }
        }
        next();
      });
    },
  };
}

const apiPort = process.env.API_PORT || "8000";

// Auto-version from Railway git SHA, or 'dev' for local development
const appVersion = process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) || "dev";

export default defineConfig({
  define: {
    "import.meta.env.VITE_APP_VERSION": JSON.stringify(appVersion),
  },
  plugins: [serveLandingPage(), react(), tailwindcss()],
  server: {
    proxy: {
      "/api": `http://localhost:${apiPort}`,
      "/auth": `http://localhost:${apiPort}`,
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
  },
});

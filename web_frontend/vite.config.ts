import { defineConfig } from "vite";
import vike from "vike/plugin";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [
    react(),
    vike({
      prerender: true,
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 3001,
    proxy: {
      "/api": {
        target: process.env.VITE_API_URL || "http://localhost:8001",
        changeOrigin: true,
      },
      "/auth": {
        target: process.env.VITE_API_URL || "http://localhost:8001",
        changeOrigin: true,
      },
    },
  },
  build: {
    target: "esnext",
  },
  ssr: {
    // react-use has ESM export issues, mark it as noExternal to bundle it
    noExternal: ["react-use"],
  },
});

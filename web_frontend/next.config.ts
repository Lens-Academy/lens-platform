import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Reduces memory usage with slight compilation slowdown
    webpackMemoryOptimizations: true,
    // Runs webpack in separate worker to reduce main process memory
    webpackBuildWorker: true,
    // Tree-shake barrel files for icon libraries
    optimizePackageImports: ["lucide-react"],
  },
};

export default nextConfig;

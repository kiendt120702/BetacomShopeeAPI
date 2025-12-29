import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */

  // Disable Turbopack in development to avoid intermittent panics
  experimental: {
    // This will fall back to Webpack
  },
};

export default nextConfig;

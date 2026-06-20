import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Heavy Node-only libraries used by the pipeline — keep them as runtime
  // requires instead of bundling (jsdom in particular breaks the bundler).
  serverExternalPackages: [
    "jsdom",
    "@mozilla/readability",
    "sharp",
    "@runwayml/sdk",
    "@anthropic-ai/sdk",
  ],
};

export default nextConfig;

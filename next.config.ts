import type { NextConfig } from "next";

// Static export: the UI is client-only (Cognito in the browser, data from API
// Gateway), and Amplify Hosting documents SSR support only up to Next.js 15.
const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;

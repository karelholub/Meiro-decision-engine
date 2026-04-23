import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["@decisioning/shared", "@decisioning/dsl", "@decisioning/engine", "@decisioning/meiro"],
  async rewrites() {
    return [
      {
        source: "/favicon.ico",
        destination: "/icon.svg"
      }
    ];
  }
};

export default nextConfig;

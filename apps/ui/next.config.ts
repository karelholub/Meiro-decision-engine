import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@decisioning/shared", "@decisioning/dsl", "@decisioning/engine", "@decisioning/meiro"]
};

export default nextConfig;

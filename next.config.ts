import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  serverExternalPackages: ["postgres"],
  // CSV imports are sent to a server action as parsed rows
  experimental: { serverActions: { bodySizeLimit: "10mb" } },
};
export default nextConfig;

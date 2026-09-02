import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  transpilePackages: ["@mandate/shared", "@mandate/types", "@mandate/schemas"],
};

export default nextConfig;

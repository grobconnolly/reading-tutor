import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Pin the Turbopack root here so a stray lockfile in a parent folder is ignored.
  turbopack: { root: process.cwd() },
};

export default nextConfig;

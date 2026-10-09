import type { NextConfig } from "next";

// `npm run dev:lan` sets AILI_LAN_HOST to this laptop's Wi-Fi address so a phone on the same
// network can load dev assets (Next 16 blocks other origins by default). Dev only.
const lanHost = process.env.AILI_LAN_HOST?.trim();

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  reactCompiler: true,
  allowedDevOrigins: lanHost ? [lanHost] : [],
};

export default nextConfig;

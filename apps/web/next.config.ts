import type { NextConfig } from "next";

const config: NextConfig = {
  // The orchestrator streams for a while; give proxy routes room.
  serverExternalPackages: ["@aws-sdk/client-s3"],
};

export default config;

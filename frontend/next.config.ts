import type { NextConfig } from "next";

const BACKEND_URL = (
  process.env.BACKEND_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  "https://social-recipe-appsocial-recipe-backend.onrender.com"
).trim();

const nextConfig: NextConfig = {
  // Next 16.3 writes AGENTS.md / CLAUDE.md into the project on dev start.
  // This repo keeps agent scaffolding out of the tree, so opt out.
  agentRules: false,
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${BACKEND_URL}/:path*`,
      },
    ];
  },
};

export default nextConfig;

import path from "node:path";
import type { NextConfig } from "next";

// Tarayıcıdan gelen /api istekleri prod'da Caddy tarafından doğrudan server'a gider;
// bu rewrite yalnız Caddy'siz yerel geliştirme ve e2e (mock API) içindir.
const apiInternal = process.env.API_INTERNAL_URL ?? "http://server:3001";

const config: NextConfig = {
  // Docker imajı: `node apps/web/server.js` (apps/web/Dockerfile); izleme kökü monorepo
  output: "standalone",
  outputFileTracingRoot: path.join(import.meta.dirname, "../.."),
  transpilePackages: ["@remote/contracts"],
  poweredByHeader: false,
  reactStrictMode: true,
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${apiInternal}/api/:path*` },
      // P4: WS sinyalizasyonu (prod'da Caddy /ws/* → server; bu yalnız Caddy'siz geliştirme/e2e)
      { source: "/ws/:path*", destination: `${apiInternal}/ws/:path*` },
    ];
  },
};

export default config;

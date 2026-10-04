import type { NextConfig } from "next";

const config: NextConfig = {
  agentRules: false,
  images: {
    unoptimized: true,
    maximumRedirects: 0,
    remotePatterns: [
      {
        protocol: "https",
        port: "",
        hostname: "media.tottus.com.pe",
        pathname: "/tottusPE/**",
      },
      {
        protocol: "https",
        port: "",
        hostname: "plazavea.vteximg.com.br",
        pathname: "/arquivos/ids/**",
      },
      {
        protocol: "https",
        port: "",
        hostname: "metroio.vteximg.com.br",
        pathname: "/arquivos/ids/**",
      },
    ],
  },

  transpilePackages: ["@comprafino/ui"],
};

export default config;

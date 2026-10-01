import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      {
        source: "/storybook",
        // Keep the trailing directory in the URL so Storybook's relative bundles resolve.
        // Next also forwards incoming query parameters (including ?path=/story/...).
        destination: "/storybook/index.html",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;

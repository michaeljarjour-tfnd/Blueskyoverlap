import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Enable longer timeouts for streaming routes
  experimental: {
    serverActions: {
      bodySizeLimit: '2mb',
    },
  },
};

export default nextConfig;

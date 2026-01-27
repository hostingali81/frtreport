import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ['@sparticuz/chromium', 'puppeteer-core'],
  compress: true,
  poweredByHeader: false,
  reactStrictMode: true,
  
  // Image optimization
  images: {
    formats: ['image/avif', 'image/webp'],
    deviceSizes: [640, 750, 828, 1080, 1200],
    minimumCacheTTL: 60 * 60 * 24 * 30, // 30 days
  },
  
  // Experimental features for better performance
  experimental: {
    optimizePackageImports: ['react-icons', 'chart.js'],
  },
};

export default nextConfig;

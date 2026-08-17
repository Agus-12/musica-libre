/** @type {import('next').NextConfig} */
const nextConfig = {
  // Vercel necesita esto para hacer fetch a otros sitios
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**" },
      { protocol: "http", hostname: "**" },
    ],
  },
  // Force these packages to be bundled in serverless functions (Vercel)
  serverExternalPackages: ["cheerio", "yt-search"],
  experimental: {
    serverComponentsExternalPackages: ["cheerio", "yt-search"],
  },
};

module.exports = nextConfig;

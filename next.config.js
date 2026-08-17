/** @type {import('next').NextConfig} */
const nextConfig = {
  // Vercel necesita esto para hacer fetch a otros sitios
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**" },
      { protocol: "http", hostname: "**" },
    ],
  },
};

module.exports = nextConfig;

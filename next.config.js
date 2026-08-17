/** @type {import('next').NextConfig} */
const nextConfig = {
  // Vercel necesita esto para hacer fetch a otros sitios
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**" },
      { protocol: "http", hostname: "**" },
    ],
  },
  /* Estos paquetes se empaquetan aparte en las funciones de Vercel.
     En Next 14 la clave va dentro de experimental; la de nivel raíz
     (serverExternalPackages) recién existe en Next 15 y hacía que el
     build tirara "Invalid next.config.js options detected". */
  experimental: {
    serverComponentsExternalPackages: ["cheerio", "yt-search"],
  },
};

module.exports = nextConfig;

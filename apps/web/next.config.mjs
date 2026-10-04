/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // GhostWire's web app is fully client-side, so it builds to a static site
  // (`out/`). This deploys to any static host (Vercel, Netlify, the relay's
  // `--serve`) with no server runtime and works offline as a PWA.
  output: "export",
  images: { unoptimized: true },
  transpilePackages: [
    "@ghostwire/crypto",
    "@ghostwire/protocol",
    "@ghostwire/roles",
    "@ghostwire/qr",
    "@ghostwire/mesh",
    "@ghostwire/transport",
  ],
};

export default nextConfig;

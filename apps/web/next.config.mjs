/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
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

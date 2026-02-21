/** @type {import('next').NextConfig} */
/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  images: {
    // Security hardening: disallow remote image optimization by default.
    remotePatterns: [],
  },
};
export default nextConfig;

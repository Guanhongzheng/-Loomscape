/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    optimizePackageImports: ['lucide-react', 'framer-motion'],
  },
  webpack: (config, { isServer }) => {
    // transformers.js touches node-only modules for its node build path
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
        url: false,
        sharp: false,
        'onnxruntime-node': false,
      };
    } else {
      config.externals = [...(config.externals ?? []), 'sharp', 'onnxruntime-node'];
    }
    return config;
  },
};

export default nextConfig;

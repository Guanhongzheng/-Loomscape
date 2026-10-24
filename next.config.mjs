/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    optimizePackageImports: ['lucide-react', 'framer-motion'],
  },
  /**
   * Scroll wasm threads need SharedArrayBuffer, and browsers only expose it to
   * a cross-origin isolated document. `credentialless` gives that without
   * requiring CORP headers on every remote image the studio may show.
   */
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          { key: 'Cross-Origin-Embedder-Policy', value: 'credentialless' },
        ],
      },
    ];
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

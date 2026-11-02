import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // One source of truth for the version shown in settings; the about panel
  // used to drift from package.json because it was a hand-written string.
  env: {
    NEXT_PUBLIC_APP_VERSION: pkg.version,
  },
  experimental: {
    optimizePackageImports: ['lucide-react', 'framer-motion'],
  },
  /**
   * Scroll wasm threads need SharedArrayBuffer, and browsers only expose it to
   * a cross-origin isolated document. `credentialless` gives that without
   * requiring CORP headers on every remote image the studio may show.
   */
  async headers() {
    /**
     * The CSP itself lives in middleware, because a nonce has to be generated
     * per request. Everything here is static and can be answered once.
     */
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          { key: 'Cross-Origin-Embedder-Policy', value: 'credentialless' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(self), geolocation=(), payment=()',
          },
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
